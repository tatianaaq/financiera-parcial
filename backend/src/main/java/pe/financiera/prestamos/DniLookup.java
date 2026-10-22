package pe.financiera.prestamos;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import jakarta.annotation.PostConstruct;
import java.net.http.HttpClient;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;

@Configuration
class DniHttpConfiguration {
    // Explicit builder avoids runtime auto-detection of HTTP clients; JSON.pe is called only by the backend.
    @Bean RestClient.Builder jsonPeRestClientBuilder() { return RestClient.builder(); }
}

record JsonPeDniRequest(String dni) {}
record JsonPeDniData(
        String numero,
        String nombres,
        @JsonProperty("apellido_paterno") String apellidoPaterno,
        @JsonProperty("apellido_materno") String apellidoMaterno) {}
record JsonPeDniResponse(boolean success, String message, JsonPeDniData data) {}
record VerifiedIdentity(String dni, String names, String paternalSurname, String maternalSurname) {
    String surnames() { return paternalSurname + " " + maternalSurname; }
}
record DniLookupResult(String dni, String names, String paternalSurname, String maternalSurname, String surnames, String verificationId) {}
record DniTicket(String username, Long agencyId, VerifiedIdentity identity, Instant expiresAt) {}

/** Cliente HTTP dedicado a JSON.pe. No registra encabezados ni el cuerpo de identidad. */
@Component
class JsonPeClient {
    private final RestClient client;
    private final String apiKey;

    JsonPeClient(RestClient.Builder builder,
                 @Value("${dni.api.url:https://api.json.pe/api/dni}") String url,
                 @Value("${dni.api.key:}") String apiKey) {
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        requestFactory.setReadTimeout(Duration.ofSeconds(6));
        this.client = builder.clone().baseUrl(url.replaceFirst("/api/dni$", ""))
                .requestFactory(requestFactory).build();
        this.apiKey = apiKey;
    }

    @PostConstruct
    void reportCredentialAvailability() {
        // Solo informa presencia/ausencia; nunca registra el contenido del token.
        System.getLogger(JsonPeClient.class.getName()).log(System.Logger.Level.INFO,
                "JSON.pe DNI_API_KEY configured: " + (apiKey != null && !apiKey.isBlank()));
    }

    JsonPeDniResponse lookup(String dni) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new DniLookupException(503, "La consulta de DNI no está configurada en esta ejecución de Spring Boot.");
        }
        try {
            return client.post().uri("/api/dni")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new JsonPeDniRequest(dni))
                    .retrieve()
                    .body(JsonPeDniResponse.class);
        } catch (RestClientResponseException error) {
            int status = error.getStatusCode().value();
            if (status == 404) throw new DniLookupException(404, "JSON.pe no encontró ese DNI.");
            if (status == 401 || status == 403) throw new DniLookupException(502, "JSON.pe rechazó la credencial configurada. Revísala en IntelliJ.");
            if (status == 429) throw new DniLookupException(429, "JSON.pe alcanzó su límite de consultas o créditos. Inténtalo más tarde.");
            if (status >= 500) throw new DniLookupException(503, "JSON.pe no está disponible temporalmente.");
            throw new DniLookupException(502, "JSON.pe rechazó la consulta. Verifica los datos e inténtalo más tarde.");
        } catch (ResourceAccessException error) {
            throw new DniLookupException(504, "La consulta a JSON.pe agotó el tiempo de espera o no pudo conectarse.");
        } catch (DniLookupException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new DniLookupException(502, "JSON.pe devolvió una respuesta que no se pudo interpretar.");
        }
    }
}

/** Valida el resultado externo y entrega tickets opacos, temporales y de un solo uso. */
@Service
class DniVerificationService {
    private static final Duration TICKET_LIFETIME = Duration.ofMinutes(5);
    private static final Duration RESULT_CACHE_LIFETIME = Duration.ofSeconds(45);
    private static final int MAX_REQUESTS_PER_MINUTE = 5;
    private final JsonPeClient provider;
    private final ClientRepository clients;
    private final Map<String, DniTicket> tickets = new ConcurrentHashMap<>();
    private final Map<String, CachedResult> recentResults = new ConcurrentHashMap<>();
    private final Map<String, RequestWindow> windows = new ConcurrentHashMap<>();
    private final Map<String, CompletableFuture<VerifiedIdentity>> inFlight = new ConcurrentHashMap<>();

    DniVerificationService(JsonPeClient provider, ClientRepository clients) {
        this.provider = provider;
        this.clients = clients;
    }

    DniLookupResult lookup(String dni, AppUser user) {
        requireActiveAdvisor(user);
        if (clients.existsByDni(dni)) {
            throw new DniLookupException(409, "Este DNI ya se encuentra registrado en el sistema.");
        }

        Instant now = Instant.now();
        enforceRateLimit(user.username, now);
        // Cache and coalesce by DNI across agencies so parallel duplicate attempts consume one provider call.
        String cacheKey = dni;
        VerifiedIdentity identity = fetchOrJoin(cacheKey, dni, now);

        String ticketId = UUID.randomUUID().toString();
        tickets.put(ticketId, new DniTicket(user.username, user.agency.id, identity, now.plus(TICKET_LIFETIME)));
        tickets.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
        recentResults.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
        return new DniLookupResult(dni, identity.names(), identity.paternalSurname(), identity.maternalSurname(), identity.surnames(), ticketId);
    }

    /** La vinculación de RUC exige consulta reciente aun cuando el DNI ya existe en la base. */
    DniLookupResult lookupForAssociation(String dni, AppUser user) {
        requireActiveAdvisor(user);
        if (!dni.matches("\\d{8}") || !clients.existsByDni(dni))
            throw new DniLookupException(404,"Primero registra la persona con DNI verificado en Clientes.");
        Instant now=Instant.now();
        enforceRateLimit(user.username,now);
        VerifiedIdentity identity=fetchOrJoin(dni,dni,now);
        String ticket=UUID.randomUUID().toString();
        tickets.put(ticket,new DniTicket(user.username,user.agency.id,identity,now.plus(TICKET_LIFETIME)));
        tickets.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
        return new DniLookupResult(dni,identity.names(),identity.paternalSurname(),identity.maternalSurname(),identity.surnames(),ticket);
    }

    /** Alta integrada desde RUC: verifica DNI aunque no exista como cliente; la BD decide si se reutiliza. */
    VerifiedIdentity verifyForOnboarding(String dni, AppUser user) {
        requireActiveAdvisor(user);
        if (dni == null || !dni.matches("\\d{8}"))
            throw new DniLookupException(400, "Ingresa un DNI de ocho dígitos.");
        Instant now = Instant.now();
        enforceRateLimit(user.username, now);
        return fetchOrJoin(dni, dni, now);
    }

    /** Mensajes específicos sin exponer contraseñas ni los tokens del proveedor. */
    private void requireActiveAdvisor(AppUser user) {
        if (user == null || !"ADVISOR".equals(user.role))
            throw new DniLookupException(403, "Tu usuario no tiene el rol ADVISOR. Entra con una cuenta de asesor o solicita revisar el rol en Supabase.");
        if (user.agency == null)
            throw new DniLookupException(403, "Tu cuenta de asesor no tiene agencia asignada. Revisa app_users.agency_id en Supabase.");
        if (!user.agency.enabled)
            throw new DniLookupException(403, "Tu agencia está deshabilitada. Revisa agencies.enabled en Supabase.");
    }

    private VerifiedIdentity fetchOrJoin(String cacheKey, String dni, Instant now) {
        CachedResult cached = recentResults.get(cacheKey);
        if (cached != null && cached.expiresAt().isAfter(now)) return cached.identity();
        if (cached != null) recentResults.remove(cacheKey, cached);

        CompletableFuture<VerifiedIdentity> mine = new CompletableFuture<>();
        CompletableFuture<VerifiedIdentity> existing = inFlight.putIfAbsent(cacheKey, mine);
        if (existing != null) {
            try { return existing.join(); }
            catch (CompletionException error) {
                if (error.getCause() instanceof RuntimeException runtime) throw runtime;
                throw new DniLookupException(502, "No se pudo completar la consulta de DNI.");
            }
        }
        try {
            VerifiedIdentity identity = validateResponse(dni, provider.lookup(dni));
            recentResults.put(cacheKey, new CachedResult(identity, Instant.now().plus(RESULT_CACHE_LIFETIME)));
            mine.complete(identity);
            return identity;
        } catch (RuntimeException error) {
            mine.completeExceptionally(error);
            throw error;
        } finally {
            inFlight.remove(cacheKey, mine);
        }
    }

    VerifiedIdentity consume(String ticketId, String dni, AppUser user) {
        DniTicket ticket = tickets.remove(ticketId);
        if (ticket == null || ticket.expiresAt().isBefore(Instant.now())
                || !ticket.username().equals(user.username)
                || user.agency == null || !ticket.agencyId().equals(user.agency.id)
                || !ticket.identity().dni().equals(dni)) {
            throw new DniLookupException(400, "La consulta de identidad venció o no corresponde a este DNI. Vuelve a consultar.");
        }
        return ticket.identity();
    }

    private VerifiedIdentity validateResponse(String requestedDni, JsonPeDniResponse response) {
        if (response == null || !response.success() || response.data() == null) {
            if (response != null && response.message() != null && response.message().toLowerCase().contains("no se encontr")) {
                throw new DniLookupException(404, "JSON.pe no encontró ese DNI.");
            }
            throw new DniLookupException(502, "JSON.pe devolvió una respuesta incompleta.");
        }
        JsonPeDniData data = response.data();
        if (!requestedDni.equals(data.numero())) throw new DniLookupException(502, "JSON.pe devolvió un DNI diferente al consultado.");
        if (blank(data.nombres()) || blank(data.apellidoPaterno()) || blank(data.apellidoMaterno())) {
            throw new DniLookupException(502, "JSON.pe no devolvió todos los nombres y apellidos.");
        }
        return new VerifiedIdentity(requestedDni, data.nombres().trim(), data.apellidoPaterno().trim(), data.apellidoMaterno().trim());
    }

    private synchronized void enforceRateLimit(String username, Instant now) {
        RequestWindow window = windows.compute(username, (key, prior) ->
                prior == null || prior.startedAt().plus(Duration.ofMinutes(1)).isBefore(now)
                        ? new RequestWindow(now, 1) : new RequestWindow(prior.startedAt(), prior.count() + 1));
        windows.entrySet().removeIf(entry -> entry.getValue().startedAt().plus(Duration.ofMinutes(2)).isBefore(now));
        if (window.count() > MAX_REQUESTS_PER_MINUTE) {
            throw new DniLookupException(429, "Alcanzaste el límite temporal de consultas de DNI. Espera un minuto.");
        }
    }

    private boolean blank(String value) { return value == null || value.isBlank(); }
    private record CachedResult(VerifiedIdentity identity, Instant expiresAt) {}
    private record RequestWindow(Instant startedAt, int count) {}
}

class DniLookupException extends RuntimeException {
    final int status;
    DniLookupException(int status, String message) { super(message); this.status = status; }
}
