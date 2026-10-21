package pe.financiera.prestamos;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/** Consulta solo lectura. Nunca expone la credencial de ElRUC.pe al navegador. */
@RestController
@RequestMapping("/api/ruc")
class RucLookupController {
    private final String apiKey;
    private final HttpClient http;
    private final ObjectMapper json;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    record Cached(JsonNode result, Instant expires) {}

    RucLookupController(@Value("${elruc.api.key:}") String apiKey, ObjectMapper json) {
        this.apiKey = apiKey;
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @GetMapping("/{ruc}")
    JsonNode find(@PathVariable String ruc) {
        if (!isValidRuc(ruc) || !(ruc.startsWith("10") || ruc.startsWith("20"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "RUC 10 o 20 inválido. Verifica sus 11 dígitos.");
        }
        Cached cached = cache.get(ruc);
        if (cached != null && cached.expires().isAfter(Instant.now())) return cached.result();
        if (apiKey == null || apiKey.isBlank()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Configura ELRUC_API_TOKEN en backend/.env para consultar RUC.");
        }
        // Para 10 es suficiente el padrón. Para 20 pedimos una sola ficha con representantes.
        String path = ruc.startsWith("20") ? "/api/v1/ruc/" + ruc + "?incluir=representantes"
                : "/api/v1/padron/" + ruc;
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create("https://elruc.pe" + path))
                    .timeout(Duration.ofSeconds(12)).header("Authorization", "Bearer " + apiKey)
                    .header("Accept", "application/json").GET().build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 429) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                        "Se alcanzó el límite de consultas de RUC. Intenta más tarde.");
            }
            if (response.statusCode() == 404) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "El RUC no aparece en el padrón.");
            }
            if (response.statusCode() != 200) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                        "No se pudo consultar ElRUC.pe (HTTP " + response.statusCode() + ").");
            }
            JsonNode result = json.readTree(response.body());
            if (!ruc.equals(result.path("ruc").asText())) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "La respuesta del proveedor no corresponde al RUC.");
            }
            cache.put(ruc, new Cached(result, Instant.now().plus(Duration.ofHours(24))));
            return result;
        } catch (ResponseStatusException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "La consulta de RUC fue interrumpida.", e);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "No se pudo conectar con el servicio de consulta de RUC.", e);
        }
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String,String>> error(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("error",
                e.getReason() == null ? "Error consultando el RUC." : e.getReason()));
    }

    /** Algoritmo de verificación SUNAT; no hace peticiones externas. */
    static boolean isValidRuc(String ruc) {
        if (ruc == null || !ruc.matches("\\d{11}")) return false;
        int[] weights = {5,4,3,2,7,6,5,4,3,2};
        int sum = 0;
        for (int i = 0; i < weights.length; i++) sum += (ruc.charAt(i) - '0') * weights[i];
        int digit = (11 - (sum % 11)) % 10;
        return digit == ruc.charAt(10) - '0';
    }
}
