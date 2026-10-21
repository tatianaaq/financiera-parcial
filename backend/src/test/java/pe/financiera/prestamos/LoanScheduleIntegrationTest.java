package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** Verifica que la originación HTTP realmente persiste la regla inclusiva en H2. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:loan_schedule_inclusive;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false",
        "app.seed.enabled=true",
        "app.seed-password=TestPass123!",
        "app.admin.password=TestPass123!",
        "dni.api.key="
})
class LoanScheduleIntegrationTest {
    @Autowired TestRestTemplate rest;
    @Autowired AgencyRepository agencies;
    @Autowired ClientRepository clients;
    @Autowired LoanRepository loans;
    @Autowired InstallmentRepository installments;
    @LocalServerPort int port;

    @Test
    void creatingALoanPersistsInclusiveThirtyDaySchedule() {
        Client client = new Client();
        client.dni = "87990021";
        client.names = "PRUEBA";
        client.surnames = "CRONOGRAMA";
        client.agency = agencies.findByName("Trujillo").orElseThrow();
        Long clientId = clients.saveAndFlush(client).id;

        LocalDate beforeRequest = LoanCalendar.todayInLima();
        ResponseEntity<Map> response = rest.withBasicAuth("asesor.trujillo", "TestPass123!")
                .postForEntity("http://localhost:" + port + "/api/loans",
                        Map.of("clientId", clientId, "amount", "900", "installments", "3", "customerAccepted", true, "quoteDate", LoanCalendar.todayInLima().toString()), Map.class);
        assertEquals(200, response.getStatusCode().value(), response.toString());
        assertNotNull(response.getBody());
        Long loanId = ((Number) response.getBody().get("id")).longValue();
        Loan loan = loans.findById(loanId).orElseThrow();
        LocalDate origin = loan.disbursedAt;
        LocalDate afterRequest = LoanCalendar.todayInLima();
        assertFalse(origin.isBefore(beforeRequest) || origin.isAfter(afterRequest),
                "La fecha de origen debe estar dentro del día civil de Lima al confirmar.");

        List<Installment> schedule = installments.findByLoanIdOrderByNumber(loanId);
        assertEquals(3, schedule.size());
        for (int number = 1; number <= 3; number++) {
            assertEquals(number, schedule.get(number - 1).number);
            assertEquals(origin.plusDays(30L * number - 1L), schedule.get(number - 1).dueDate);
        }
    }
}
