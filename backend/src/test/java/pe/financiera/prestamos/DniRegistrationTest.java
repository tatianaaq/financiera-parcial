package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.context.annotation.Import;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:financiera_v2_dni_tests;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
        "app.seed.enabled=true",
        "app.seed-password=TestPass123!",
        "app.admin.password=TestPass123!",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false",
        "dni.api.key="
})
@Import(JsonPeTestConfiguration.class)
class DniRegistrationTest {
    @Autowired TestRestTemplate rest;
    @Autowired FakeJsonPeClient provider;
    @LocalServerPort int port;

    @Test
    void consultaSimuladaCompletaYGuardaEnAgenciaAutenticada() {
        String dni = "82100001";
        provider.respond(dni, identity(dni));
        TestRestTemplate advisor = advisor("trujillo");

        ResponseEntity<Map> lookup = lookup(advisor, dni);
        assertEquals(HttpStatus.OK, lookup.getStatusCode());
        assertEquals("ANA MARIA", lookup.getBody().get("names"));
        assertEquals("PEREZ", lookup.getBody().get("paternalSurname"));
        assertEquals("GOMEZ", lookup.getBody().get("maternalSurname"));

        Map body = lookup.getBody();
        ResponseEntity<Map> saved = advisor.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(clientInput(dni, body.get("names"), body.get("surnames"), "912345678", body.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.OK, saved.getStatusCode());
        assertEquals("ANA MARIA", ((Map<?, ?>) saved.getBody()).get("names"));
        assertEquals(1L, countDniInAgency(advisor, dni), "El DNI de esta prueba debe aparecer una sola vez.");
        assertEquals(0L, countDniInAgency(advisor("chimbote"), dni),
                "La sede se asigna desde la sesión y este DNI no aparece en otra agencia.");
        assertEquals(1, provider.callsFor(dni));
    }

    @Test
    void dniDuplicadoEnOtraAgenciaSeBloqueaAntesDeConsumirProveedor() {
        String dni = "82100002";
        provider.respond(dni, identity(dni));
        TestRestTemplate trujillo = advisor("trujillo");
        Map ticket = lookup(trujillo, dni).getBody();
        ResponseEntity<Map> saved = trujillo.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(clientInput(dni, ticket.get("names"), ticket.get("surnames"), "912345678", ticket.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.OK, saved.getStatusCode());

        ResponseEntity<Map> duplicate = lookup(advisor("chimbote"), dni);
        assertEquals(HttpStatus.CONFLICT, duplicate.getStatusCode());
        assertEquals("Este DNI ya se encuentra registrado en el sistema.", duplicate.getBody().get("error"));
        assertEquals(1, provider.callsFor(dni));
    }

    @Test
    void consultaDeExistenciaDevuelve200SinInvocarProveedor() {
        String dni = "82100012";
        TestRestTemplate trujillo = advisor("trujillo");
        ResponseEntity<Map> noExiste = trujillo.getForEntity(url("/api/clients/registration-status?dni=" + dni), Map.class);
        assertEquals(HttpStatus.OK, noExiste.getStatusCode());
        assertEquals(false, noExiste.getBody().get("exists"));
        assertEquals(0, provider.callsFor(dni));

        provider.respond(dni, identity(dni));
        Map ticket = lookup(trujillo, dni).getBody();
        ResponseEntity<Map> creado = trujillo.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(Map.of("dni", dni, "names", ticket.get("names"),
                        "surnames", ticket.get("surnames"), "verificationId", ticket.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.OK, creado.getStatusCode());

        ResponseEntity<Map> existe = advisor("piura").getForEntity(url("/api/clients/registration-status?dni=" + dni), Map.class);
        assertEquals(HttpStatus.OK, existe.getStatusCode());
        assertEquals(true, existe.getBody().get("exists"));
        assertEquals("Trujillo", existe.getBody().get("agency"));
        assertEquals(1, provider.callsFor(dni));
    }

    @Test
    void unAdministradorNoPuedeVerificarDniYRecibeMotivoEntendible() {
        String dni = "82100013";
        ResponseEntity<Map> denied = rest.withBasicAuth("admin", "TestPass123!")
                .exchange(url("/api/clients/dni-lookup"), HttpMethod.POST,
                        new HttpEntity<>(Map.of("dni", dni)), Map.class);
        assertEquals(HttpStatus.FORBIDDEN, denied.getStatusCode());
        assertTrue(denied.getBody().get("error").toString().contains("ADVISOR"));
        assertEquals(0, provider.callsFor(dni));
    }

    @Test
    void perfilDelAsesorExponeEstadoDeAgenciaSinCredenciales() {
        ResponseEntity<Map> response = advisor("trujillo").getForEntity(url("/api/me"), Map.class);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("ADVISOR", response.getBody().get("role"));
        assertEquals(true, response.getBody().get("agencyEnabled"));
        assertEquals(true, response.getBody().get("canRegisterClients"));
        assertFalse(response.getBody().containsKey("password"));
    }

    @Test
    void rechazaDniInvalidoYNoLlamaAlProveedor() {
        ResponseEntity<Map> response = advisor("trujillo").exchange(url("/api/clients/dni-lookup"), HttpMethod.POST,
                new HttpEntity<>(Map.of("dni", "123 4567")), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertEquals(0, provider.callsFor("123 4567"));
    }

    @Test
    void rechazaNombresManipuladosYNoGuardaElCliente() {
        String dni = "82100003";
        provider.respond(dni, identity(dni));
        Map ticket = lookup(advisor("piura"), dni).getBody();
        ResponseEntity<Map> response = advisor("piura").exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(clientInput(dni, "NOMBRE MANIPULADO", ticket.get("surnames"), "912345678", ticket.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertTrue(response.getBody().get("error").toString().contains("coincidir"));
        assertEquals(0L, countDniInAgency(advisor("piura"), dni),
                "No debe guardarse la identidad manipulada.");
    }

    @Test
    void entregaErroresExternosComoMensajesControlados() {
        provider.fail("82100004", new DniLookupException(429, "JSON.pe alcanzó su límite temporal."));
        ResponseEntity<Map> limited = lookup(advisor("trujillo"), "82100004");
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, limited.getStatusCode());
        assertTrue(limited.getBody().get("error").toString().contains("límite"));

        provider.fail("82100005", new DniLookupException(504, "La consulta agotó el tiempo de espera."));
        ResponseEntity<Map> timeout = lookup(advisor("chiclayo"), "82100005");
        assertEquals(HttpStatus.GATEWAY_TIMEOUT, timeout.getStatusCode());
        assertFalse(timeout.getBody().toString().contains("Authorization"));
    }

    @Test
    void requiereSesionAutenticada() {
        ResponseEntity<Map> response = rest.postForEntity(url("/api/clients/dni-lookup"), Map.of("dni", "82100006"), Map.class);
        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        assertEquals(0, provider.callsFor("82100006"));
    }

    @Test
    void solicitudesParalelasDelMismoDniCompartenUnaConsultaExterna() {
        String dni = "82100007";
        provider.respondAfter(dni, identity(dni), java.time.Duration.ofMillis(350));
        TestRestTemplate advisor = advisor("tumbes");
        CompletableFuture<ResponseEntity<Map>> first = CompletableFuture.supplyAsync(() -> lookup(advisor, dni));
        CompletableFuture<ResponseEntity<Map>> second = CompletableFuture.supplyAsync(() -> lookup(advisor, dni));
        assertEquals(HttpStatus.OK, first.join().getStatusCode());
        assertEquals(HttpStatus.OK, second.join().getStatusCode());
        assertEquals(1, provider.callsFor(dni));
    }

    @Test
    void rechazaRespuestaIncompletaODniDistinto() {
        provider.respond("82100008", new JsonPeDniResponse(true, "exito",
                new JsonPeDniData("00000000", "ANA", "PEREZ", "GOMEZ")));
        ResponseEntity<Map> mismatch = lookup(advisor("chiclayo"), "82100008");
        assertEquals(HttpStatus.BAD_GATEWAY, mismatch.getStatusCode());
        assertTrue(mismatch.getBody().get("error").toString().contains("diferente"));

        provider.respond("82100009", new JsonPeDniResponse(true, "exito",
                new JsonPeDniData("82100009", "ANA", "", "GOMEZ")));
        ResponseEntity<Map> incomplete = lookup(advisor("piura"), "82100009");
        assertEquals(HttpStatus.BAD_GATEWAY, incomplete.getStatusCode());
        assertTrue(incomplete.getBody().get("error").toString().contains("apellidos"));
    }

    @Test
    void registraSoloConDniVerificadoSinCelularNiDomicilio() {
        String dni = "82100011";
        provider.respond(dni, identity(dni));
        TestRestTemplate trujillo = advisor("trujillo");
        Map result = lookup(trujillo, dni).getBody();
        ResponseEntity<Map> saved = trujillo.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(Map.of("dni", dni, "names", result.get("names"),
                        "surnames", result.get("surnames"), "verificationId", result.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.OK, saved.getStatusCode());
        assertEquals(dni, saved.getBody().get("dni"));
        assertNull(saved.getBody().get("phone"));
        assertNull(saved.getBody().get("address"));
        assertNull(saved.getBody().get("ubigeo"));
        assertEquals("Trujillo", saved.getBody().get("agency"));
        assertEquals(1, provider.callsFor(dni));
        assertEquals(HttpStatus.CONFLICT, lookup(advisor("piura"), dni).getStatusCode());
    }

    @Test
    void exigeCelularPeruanoDeNueveDigitos() {
        String dni = "82100010";
        provider.respond(dni, identity(dni));
        Map ticket = lookup(advisor("trujillo"), dni).getBody();
        ResponseEntity<Map> response = advisor("trujillo").exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(clientInput(dni, ticket.get("names"), ticket.get("surnames"), "812345678", ticket.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertEquals(0L, countDniInAgency(advisor("trujillo"), dni),
                "Un teléfono inválido no debe registrar ese DNI.");
    }

    /**
     * Estas pruebas comparten el contexto H2: otras pruebas pueden haber creado
     * clientes en la misma agencia. Comprobamos el DNI bajo prueba, no el
     * tamano total del directorio, para evitar dependencia del orden JUnit.
     */
    private long countDniInAgency(TestRestTemplate advisor, String dni) {
        java.util.List<?> clients = advisor.getForObject(url("/api/clients"), java.util.List.class);
        assertNotNull(clients);
        long matches = 0;
        for (Object item : clients) {
            if (item instanceof Map<?, ?> client && dni.equals(client.get("dni"))) {
                matches++;
            }
        }
        return matches;
    }

    private JsonPeDniResponse identity(String dni) {
        return new JsonPeDniResponse(true, "exito", new JsonPeDniData(dni, "ANA MARIA", "PEREZ", "GOMEZ"));
    }

    private Map<String, Object> clientInput(String dni, Object names, Object surnames, String phone, Object verificationId) {
        return Map.ofEntries(Map.entry("dni", dni), Map.entry("names", names), Map.entry("surnames", surnames),
                Map.entry("phone", phone), Map.entry("department", "La Libertad"), Map.entry("province", "Trujillo"),
                Map.entry("district", "Víctor Larco Herrera"), Map.entry("ubigeo", "130111"),
                Map.entry("address", "Av. Larco 123"), Map.entry("addressReference", ""),
                Map.entry("verificationId", verificationId));
    }

    private ResponseEntity<Map> lookup(TestRestTemplate advisor, String dni) {
        return advisor.exchange(url("/api/clients/dni-lookup"), HttpMethod.POST, new HttpEntity<>(Map.of("dni", dni)), Map.class);
    }

    private TestRestTemplate advisor(String agency) { return rest.withBasicAuth("asesor." + agency, "TestPass123!"); }
    private String url(String path) { return "http://localhost:" + port + path; }
}
