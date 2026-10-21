package pe.financiera.prestamos;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "spring.datasource.url=jdbc:h2:mem:cross_branch;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.jpa.hibernate.ddl-auto=create-drop", "spring.flyway.enabled=false",
    "app.seed.enabled=true", "app.seed-password=TestPass123!", "app.admin.password=TestPass123!", "dni.api.key="
})
class CrossAgencyLoanTest {
    @Autowired AgencyRepository agencies;
    @Autowired ClientRepository clients;
    @Autowired TestRestTemplate rest;
    @LocalServerPort int port;
    private static final AtomicInteger NEXT = new AtomicInteger(1);
    Long clientId;

    @BeforeEach void setUp() {
        Client c = new Client();
        c.dni=String.format("87%06d",NEXT.getAndIncrement());
        c.names="CLIENTE"; c.surnames="DE PRUEBA";
        c.agency=agencies.findByName("Piura").orElseThrow();
        clientId=clients.saveAndFlush(c).id;
    }

    ResponseEntity<Map> send(String agency, String url, String amount) {
        return rest.withBasicAuth("asesor."+agency, "TestPass123!")
                .postForEntity("http://localhost:"+port+url,
                    Map.of("clientId",clientId,"amount",amount,"installments","6","customerAccepted",true,"quoteDate",LoanCalendar.todayInLima().toString()),Map.class);
    }

    @Test void crossOfficeLoanCanBeEvaluatedWithinRemainingNationalLimit() {
        assertEquals(200,send("piura", "/api/loans", "6000").getStatusCode().value());
        ResponseEntity<Map> evaluation=send("chimbote", "/api/loans/evaluation", "4000");
        assertEquals(200,evaluation.getStatusCode().value(),evaluation.toString());
        assertEquals("Chimbote",evaluation.getBody().get("agency"));
        assertEquals(0, new java.math.BigDecimal(evaluation.getBody().get("availableOriginalCapital").toString()).compareTo(new java.math.BigDecimal("4000.00")));
    }

    @Test void secondOfficeCanGrantButCannotExceedNationalOriginalCapitalLimit() {
        assertEquals(200,send("piura", "/api/loans", "6000").getStatusCode().value());
        ResponseEntity<Map> second=send("chimbote", "/api/loans", "4000");
        assertEquals(200,second.getStatusCode().value(),second.toString());
        assertEquals("Chimbote",second.getBody().get("agency"));
        ResponseEntity<Map> third=send("chimbote", "/api/loans", "1");
        assertTrue(third.getStatusCode().is4xxClientError(),"No debe superar el límite nacional de 10,000");
    }
}
