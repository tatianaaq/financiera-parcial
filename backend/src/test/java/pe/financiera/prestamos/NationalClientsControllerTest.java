package pe.financiera.prestamos;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:financiera_v2_national_tests;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false",
        "app.seed.enabled=true",
        "app.seed-password=TestPass123!",
        "app.admin.password=TestPass123!",
        "dni.api.key="
})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class NationalClientsControllerTest {
    @Autowired TestRestTemplate rest;
    @Autowired AgencyRepository agencies;
    @Autowired UserRepository users;
    @Autowired ClientRepository clients;
    @Autowired LoanRepository loans;
    @Autowired InstallmentRepository installments;
    @LocalServerPort int port;

    private static final String TEST_DNI = "81234567";
    private Long piuraLoanId;
    private Long chimboteLoanId;

    @BeforeAll
    void createFixtures() {
        Agency piura = agencies.findByName("Piura").orElseThrow();
        Agency chimbote = agencies.findByName("Chimbote").orElseThrow();
        AppUser piuraAdvisor = users.findByUsername("asesor.piura").orElseThrow();
        AppUser chimboteAdvisor = users.findByUsername("asesor.chimbote").orElseThrow();
        Client client = new Client();
        client.dni = TEST_DNI;
        client.names = "PRUEBA";
        client.surnames = "NACIONAL";
        client.agency = piura;
        client = clients.saveAndFlush(client);
        piuraLoanId = createLoan(client, piura, piuraAdvisor, "6000.00");
        chimboteLoanId = createLoan(client, chimbote, chimboteAdvisor, "4000.00");
    }

    private Long createLoan(Client client, Agency agency, AppUser advisor, String capital) {
        Loan loan = new Loan();
        loan.client = client;
        loan.agency = agency;
        loan.createdBy = advisor;
        loan.principal = new BigDecimal(capital);
        loan.outstandingPrincipal = loan.principal;
        loan.installments = 1;
        loan.disbursedAt = LocalDate.now();
        loan = loans.saveAndFlush(loan);

        Installment installment = new Installment();
        installment.loan = loan;
        installment.number = 1;
        installment.dueDate = LocalDate.now().plusDays(30);
        installment.principalDue = loan.principal;
        installment.interestDue = BigDecimal.ZERO;
        installment.insuranceDue = BigDecimal.ZERO;
        installments.saveAndFlush(installment);
        return loan.id;
    }

    private String url(String path) { return "http://localhost:" + port + path; }
    private TestRestTemplate chimboteAdvisor() {
        return rest.withBasicAuth("asesor.chimbote", "TestPass123!");
    }

    @Test
    @SuppressWarnings("unchecked")
    void advisorCanFindClientAndLoansFromTwoAgencies() {
        ResponseEntity<Map> response = chimboteAdvisor().getForEntity(
                url("/api/clients/national?dni=" + TEST_DNI), Map.class);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        Map<String, Object> body = response.getBody();
        assertEquals(TEST_DNI, body.get("dni"));
        assertEquals("Piura", body.get("agency"));
        assertEquals(0, new BigDecimal(body.get("availableOriginalCapital").toString()).compareTo(BigDecimal.ZERO));
        assertEquals(0, new BigDecimal(body.get("activeOriginalCapital").toString()).compareTo(new BigDecimal("10000.00")));
        List<Map<String, Object>> clientLoans = (List<Map<String, Object>>) body.get("loans");
        assertEquals(2, clientLoans.size());
        assertTrue(clientLoans.stream().anyMatch(l -> "Piura".equals(l.get("agency"))));
        assertTrue(clientLoans.stream().anyMatch(l -> "Chimbote".equals(l.get("agency"))));
        assertFalse(body.containsKey("phone"), "The national lookup should not leak contact details.");
    }

    @Test
    void advisorCanReadOtherAgencySchedule() {
        ResponseEntity<List> response = chimboteAdvisor().getForEntity(
                url("/api/clients/national/" + TEST_DNI + "/loans/" + piuraLoanId + "/schedule"), List.class);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertEquals(1, response.getBody().size());
    }

    @Test
    void loanScheduleCannotBeReadWithDifferentDni() {
        ResponseEntity<Map> response = chimboteAdvisor().getForEntity(
                url("/api/clients/national/99999999/loans/" + chimboteLoanId + "/schedule"), Map.class);
        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
    }

    @Test
    void invalidDniIsRejected() {
        ResponseEntity<Map> response = chimboteAdvisor().getForEntity(
                url("/api/clients/national?dni=123"), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    }

    @Test
    void unknownDniReturnsNotFound() {
        ResponseEntity<Map> response = chimboteAdvisor().getForEntity(
                url("/api/clients/national?dni=99999999"), Map.class);
        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
    }

    @Test
    void anonymousCannotPerformNationalSearch() {
        ResponseEntity<String> response = rest.getForEntity(
                url("/api/clients/national?dni=" + TEST_DNI), String.class);
        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
    }
}
