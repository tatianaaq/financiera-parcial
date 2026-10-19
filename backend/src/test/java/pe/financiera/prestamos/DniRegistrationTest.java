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
        assertEquals(1, advisor.getForObject(url("/api/clients"), java.util.List.class).size());
        assertTrue(advisor("chimbote").getForObject(url("/api/clients"), java.util.List.class).isEmpty(),
                "La sede se asigna desde la sesión y el cliente no aparece en otra agencia.");
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
        assertTrue(advisor("piura").getForObject(url("/api/clients"), java.util.List.class).isEmpty());
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
    void exigeCelularPeruanoDeNueveDigitos() {
        String dni = "82100010";
        provider.respond(dni, identity(dni));
        Map ticket = lookup(advisor("trujillo"), dni).getBody();
        ResponseEntity<Map> response = advisor("trujillo").exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(clientInput(dni, ticket.get("names"), ticket.get("surnames"), "812345678", ticket.get("verificationId"))), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertTrue(advisor("trujillo").getForObject(url("/api/clients"), java.util.List.class).isEmpty());
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
