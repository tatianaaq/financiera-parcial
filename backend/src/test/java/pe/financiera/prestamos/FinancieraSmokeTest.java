package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.context.annotation.Import;

import java.math.BigDecimal;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:financiera_v2_tests;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
        "app.seed.enabled=true",
        "app.seed-password=TestPass123!",
        "app.admin.password=TestPass123!",
        "app.admin.username=admin",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.flyway.enabled=false"
})
@Import(JsonPeTestConfiguration.class)
class FinancieraSmokeTest {
    @Autowired TestRestTemplate rest;
    @Autowired FakeJsonPeClient jsonPeClient;
    @Autowired ClientRepository clients;
    @Autowired LoanRepository loans;
    @Autowired AgencyRepository agencies;
    @Autowired UserRepository users;
    @LocalServerPort int port;
    private final List<Long> fixtureClientIds = new java.util.ArrayList<>();
    private final List<Long> fixtureLoanIds = new java.util.ArrayList<>();

    @AfterEach
    void cleanAgencyFilterFixtures() {
        loans.deleteAllById(fixtureLoanIds);
        clients.deleteAllById(fixtureClientIds);
        fixtureLoanIds.clear();
        fixtureClientIds.clear();
    }

    @Test
    void projectKeepsOneAdministratorAndOneAdvisorPerAgencyAndDisablesAccountCreation() {
        TestRestTemplate admin = rest.withBasicAuth("admin", "TestPass123!");
        List<Map> initialUsers = admin.getForObject(url("/api/admin/users"), List.class);
        assertNotNull(initialUsers);
        assertEquals(6, initialUsers.size());
        assertTrue(initialUsers.stream().allMatch(user -> Boolean.TRUE.equals(user.get("enabled"))));
        assertTrue(initialUsers.stream().anyMatch(user -> "admin".equals(user.get("username"))
                && "ADMIN".equals(user.get("role"))));
        for (String agency : List.of("Chimbote", "Trujillo", "Chiclayo", "Piura", "Tumbes")) {
            assertEquals(1, initialUsers.stream().filter(user -> "ADVISOR".equals(user.get("role"))
                    && agency.equals(user.get("agency"))).count(), "Each project agency must have one advisor.");
        }

        ResponseEntity<Map> adminCreate = admin.exchange(url("/api/admin/users"), HttpMethod.POST,
                new HttpEntity<>(Map.of("username", "asesor.extra", "password", "TestPass123!", "role", "ADVISOR", "agencyId", 1)), Map.class);
        assertEquals(HttpStatus.FORBIDDEN, adminCreate.getStatusCode(),
                "The administrator API must not create additional accounts.");
        TestRestTemplate advisor = rest.withBasicAuth("asesor.trujillo", "TestPass123!");
        assertEquals(HttpStatus.FORBIDDEN, advisor.exchange(url("/api/admin/users"), HttpMethod.POST,
                new HttpEntity<>(Map.of("username", "asesor.intruso", "password", "TestPass123!", "role", "ADVISOR", "agencyId", 1)), Map.class).getStatusCode());
        assertEquals(6, admin.getForObject(url("/api/admin/users"), List.class).size(),
                "Blocked account creation must leave all six seeded accounts unchanged.");
    }

    @Test
    void newLoanHasNoInsuranceOptionAndClientDirectoryIsBranchScoped() {
        assertEquals(HttpStatus.UNAUTHORIZED, rest.getForEntity(url("/api/me"), Map.class).getStatusCode());

        TestRestTemplate trujillo = rest.withBasicAuth("asesor.trujillo", "TestPass123!");
        TestRestTemplate chimbote = rest.withBasicAuth("asesor.chimbote", "TestPass123!");
        assertEquals(HttpStatus.FORBIDDEN, trujillo.getForEntity(url("/api/dashboard/agencies"), Map.class).getStatusCode(),
                "Agency-wide metrics must be reserved for the administrator.");
        jsonPeClient.respond("87654321", new JsonPeDniResponse(true, "exito",
                new JsonPeDniData("87654321", "SMOKE", "TEST", "CLIENT")));
        ResponseEntity<Map> lookupResponse = trujillo.exchange(url("/api/clients/dni-lookup"), HttpMethod.POST,
                new HttpEntity<>(Map.of("dni", "87654321")), Map.class);
        assertTrue(lookupResponse.getStatusCode().is2xxSuccessful());
        String verificationId = (String) lookupResponse.getBody().get("verificationId");
        Map<String, Object> clientBody = new HashMap<>(Map.ofEntries(Map.entry("dni", "87654321"), Map.entry("names", "SMOKE"),
                        Map.entry("surnames", "TEST CLIENT"), Map.entry("phone", "912345678"),
                        Map.entry("department", "Lambayeque"), Map.entry("province", "Chiclayo"),
                        Map.entry("district", "Chiclayo"), Map.entry("ubigeo", "140101"),
                        Map.entry("address", "Av. Larco 123"), Map.entry("addressReference", "Frente al parque"),
                        Map.entry("verificationId", verificationId)));
        Map<String, Object> invalidDniBody = new HashMap<>(clientBody);
        invalidDniBody.put("dni", "1234ABCD");
        assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(invalidDniBody), Map.class).getStatusCode(), "The server must reject a non-numeric DNI.");
        Map<String, Object> invalidPhoneBody = new HashMap<>(clientBody);
        invalidPhoneBody.put("phone", "98765ABCD");
        assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(invalidPhoneBody), Map.class).getStatusCode(), "The server must reject a non-numeric phone.");
        ResponseEntity<Map> clientResponse = trujillo.exchange(url("/api/clients"), HttpMethod.POST,
                new HttpEntity<>(clientBody), Map.class);
        assertTrue(clientResponse.getStatusCode().is2xxSuccessful());
        assertEquals("Lambayeque", clientResponse.getBody().get("department"), "A Trujillo advisor may register a client living in a different department.");
        assertEquals("Chiclayo", clientResponse.getBody().get("province"));
        assertEquals("140101", clientResponse.getBody().get("ubigeo"));
        assertEquals("Av. Larco 123", clientResponse.getBody().get("address"));
        assertEquals("Frente al parque", clientResponse.getBody().get("addressReference"));
        Long clientId = ((Number) clientResponse.getBody().get("id")).longValue();
        Client legacyClient = new Client();
        legacyClient.agency = agencies.findByName("Trujillo").orElseThrow();
        legacyClient.dni = "87654322"; legacyClient.names = "LEGACY"; legacyClient.surnames = "CLIENT";
        legacyClient.phone = "912345679"; legacyClient.address = null;
        Long legacyClientId = clients.saveAndFlush(legacyClient).id;
        assertEquals(HttpStatus.OK, trujillo.getForEntity(url("/api/clients/" + legacyClientId), Map.class).getStatusCode(),
                "Legacy clients without a domicile must remain readable.");
        ResponseEntity<Map> legacyUpdate = trujillo.exchange(url("/api/clients/" + legacyClientId + "/address"), HttpMethod.PUT,
                new HttpEntity<>(addressInput("Lambayeque", "Chiclayo", "Chiclayo", "140101", "Calle Lima 20", "")), Map.class);
        assertEquals(HttpStatus.OK, legacyUpdate.getStatusCode(), "An advisor can complete an old client's missing domicile.");
        assertEquals("Calle Lima 20", legacyUpdate.getBody().get("address"));
        ResponseEntity<Map> invalidLocationUpdate = trujillo.exchange(url("/api/clients/" + clientId + "/address"), HttpMethod.PUT,
                new HttpEntity<>(addressInput("La Libertad", "Chiclayo", "Chiclayo", "140101", "Dirección inválida", "")), Map.class);
        assertEquals(HttpStatus.BAD_REQUEST, invalidLocationUpdate.getStatusCode(), "The backend must reject inconsistent UBIGEO names.");
        assertEquals("Av. Larco 123", trujillo.getForObject(url("/api/clients/" + clientId), Map.class).get("address"),
                "An invalid domicile update must leave the existing address untouched.");
        assertEquals(HttpStatus.FORBIDDEN, chimbote.exchange(url("/api/clients/" + clientId + "/address"), HttpMethod.PUT,
                new HttpEntity<>(addressInput("Lambayeque", "Chiclayo", "Chiclayo", "140101", "Jr. Lima 45", "")), Map.class).getStatusCode(),
                "An advisor cannot update a client belonging to another agency.");

        assertEquals(HttpStatus.OK, trujillo.getForEntity(url("/api/clients/" + clientId), Map.class).getStatusCode(),
                "The advisor must open detail for a client in the same agency.");
        assertEquals(HttpStatus.OK, trujillo.getForEntity(url("/api/clients/" + clientId + "/loans"), List.class).getStatusCode(),
                "The advisor must open credits for a client in the same agency.");
        TestRestTemplate admin = rest.withBasicAuth("admin", "TestPass123!");
        assertEquals(HttpStatus.FORBIDDEN, admin.exchange(url("/api/clients/" + clientId + "/address"), HttpMethod.PUT,
                new HttpEntity<>(addressInput("Lambayeque", "Chiclayo", "Chiclayo", "140101", "Jr. Lima 45", "")), Map.class).getStatusCode(),
                "The administrator retains read-only client access.");
        assertEquals("Lambayeque", admin.getForObject(url("/api/clients/" + clientId), Map.class).get("department"),
                "The administrator can read client domicile across agencies.");
        List<Map> agencies = admin.getForObject(url("/api/admin/agencies"), List.class);
        assertNotNull(agencies);
        long trujilloAgencyId = agencies.stream().filter(a -> "Trujillo".equals(a.get("name")))
                .mapToLong(a -> ((Number)a.get("id")).longValue()).findFirst().orElseThrow();
        long chimboteAgencyId = agencies.stream().filter(a -> "Chimbote".equals(a.get("name")))
                .mapToLong(a -> ((Number)a.get("id")).longValue()).findFirst().orElseThrow();
        List<Map> trujilloClients = admin.getForObject(url("/api/clients?agencyId=" + trujilloAgencyId), List.class);
        assertNotNull(trujilloClients);
        assertTrue(trujilloClients.stream().anyMatch(c -> clientId.equals(((Number)c.get("id")).longValue())),
                "The administrator agency filter must return clients assigned to Trujillo.");
        Map filteredClient = trujilloClients.stream().filter(c -> clientId.equals(((Number)c.get("id")).longValue())).findFirst().orElseThrow();
        assertEquals("Trujillo", filteredClient.get("agency"), "Filtered client API payload: " + filteredClient);
        assertEquals(trujilloAgencyId, ((Number) filteredClient.get("agencyId")).longValue(),
                "Client API responses must expose the database agency ID so the UI can filter without comparing names.");
        Map byDniClient = trujillo.getForObject(url("/api/clients/by-dni?dni=87654321"), Map.class);
        assertEquals("Trujillo", byDniClient.get("agency"), "DNI lookup must resolve the lazy agency relation while mapping the response.");
        assertEquals(trujilloAgencyId, ((Number) byDniClient.get("agencyId")).longValue());

        Map<String, Object> request = Map.of("clientId", clientId, "amount", 1200, "installments", 6, "customerAccepted", true, "quoteDate", LoanCalendar.todayInLima().toString());
        Map<String, Object> decimalRequest = Map.of("clientId", clientId, "amount", new BigDecimal("1200.50"), "installments", 6);
        assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/loans/evaluation"), HttpMethod.POST,
                new HttpEntity<>(decimalRequest), Map.class).getStatusCode(),
                "The loan evaluation endpoint must reject a fractional principal.");
        assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/loans"), HttpMethod.POST,
                new HttpEntity<>(decimalRequest), Map.class).getStatusCode(),
                "The loan creation endpoint must reject a fractional principal.");
        List<Map> invalidLoanInputs = List.of(
                Map.of("clientId", clientId, "amount", "1e3", "installments", "6"),
                Map.of("clientId", clientId, "amount", "1500.50", "installments", "6"),
                Map.of("clientId", clientId, "amount", "1000", "installments", "3e2"),
                Map.of("clientId", clientId, "amount", "1000", "installments", "6.5"),
                Map.of("clientId", clientId, "amount", "-500", "installments", "6"));
        for (Map invalidInput : invalidLoanInputs) {
            assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/loans/evaluation"), HttpMethod.POST,
                    new HttpEntity<>(invalidInput), Map.class).getStatusCode(),
                    "The server must reject exponential notation, fractions, signs, and invalid whole-number fields.");
            assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/loans"), HttpMethod.POST,
                    new HttpEntity<>(invalidInput), Map.class).getStatusCode(),
                    "Loan creation must also reject invalid numeric text before writing any record.");
        }
        HttpHeaders jsonHeaders = new HttpHeaders();
        jsonHeaders.setContentType(MediaType.APPLICATION_JSON);
        String exponentialAmount = "{\"clientId\":" + clientId + ",\"amount\":1e3,\"installments\":6}";
        assertEquals(HttpStatus.BAD_REQUEST, trujillo.exchange(url("/api/loans/evaluation"), HttpMethod.POST,
                new HttpEntity<>(exponentialAmount, jsonHeaders), Map.class).getStatusCode(),
                "Raw JSON scientific notation must be rejected rather than parsed as an integer amount.");
        assertEquals(HttpStatus.BAD_REQUEST, admin.getForEntity(url("/api/clients?q=Perez%40"), Map.class).getStatusCode(),
                "The client search API must reject special characters.");
        ResponseEntity<Object> unicodeSearch = admin.getForEntity(URI.create(url("/api/clients?q=Mar%C3%ADa%20Mu%C3%B1oz")), Object.class);
        assertEquals(HttpStatus.OK, unicodeSearch.getStatusCode(), "The client search API must allow Spanish names with accents and ñ: " + unicodeSearch.getBody());
        ResponseEntity<Map> evaluation = trujillo.exchange(url("/api/loans/evaluation"), HttpMethod.POST,
                new HttpEntity<>(request), Map.class);
        assertTrue(evaluation.getStatusCode().is2xxSuccessful());
        assertFalse(evaluation.getBody().containsKey("insurance"), "The new-loan API must not expose an insurance option.");
        double paymentEstimate = ((Number) evaluation.getBody().get("monthlyPaymentEstimate")).doubleValue();
        assertTrue(paymentEstimate > 0);
        assertNotEquals(Math.rint(paymentEstimate), paymentEstimate, 0.001,
                "The estimated installment must preserve its decimal amount.");
        assertTrue(trujillo.getForObject(url("/api/loans"), List.class).isEmpty(),
                "A loan evaluation must not write a loan before explicit confirmation.");

        ResponseEntity<Map> loanResponse = trujillo.exchange(url("/api/loans"), HttpMethod.POST,
                new HttpEntity<>(request), Map.class);
        assertTrue(loanResponse.getStatusCode().is2xxSuccessful());
        Long loanId = ((Number) loanResponse.getBody().get("id")).longValue();
        assertEquals(clientId, ((Number) loanResponse.getBody().get("clientId")).longValue());
        assertEquals("Trujillo", loanResponse.getBody().get("agency"));
        assertEquals(trujilloAgencyId, ((Number) loanResponse.getBody().get("agencyId")).longValue(),
                "Loan API responses must expose the database agency ID for consistent agency indicators.");
        assertEquals(1200.0, ((Number) loanResponse.getBody().get("principal")).doubleValue(), 0.001);
        assertEquals(6, ((Number) loanResponse.getBody().get("installments")).intValue());
        List<Map> clientLoans = trujillo.getForObject(url("/api/clients/" + clientId + "/loans"), List.class);
        assertNotNull(clientLoans);
        assertEquals(1, clientLoans.size(), "The client's credits view must return each recorded loan once.");
        List<Map> schedule = trujillo.getForObject(url("/api/loans/" + loanId + "/schedule"), List.class);
        assertNotNull(schedule);
        assertEquals(6, schedule.size(), "A successfully created loan must persist its full installment schedule.");
        assertNotEquals(Math.rint(((Number) schedule.get(0).get("interest")).doubleValue()),
                ((Number) schedule.get(0).get("interest")).doubleValue(), 0.001,
                "The installment schedule must preserve decimal interest amounts.");
        ResponseEntity<Map> updatedAddress = trujillo.exchange(url("/api/clients/" + clientId + "/address"), HttpMethod.PUT,
                new HttpEntity<>(addressInput("Lambayeque", "Chiclayo", "Chiclayo", "140101", "Jr. Lima 45", "Cerca del mercado")), Map.class);
        assertEquals(HttpStatus.OK, updatedAddress.getStatusCode());
        assertEquals(clientId, ((Number) updatedAddress.getBody().get("id")).longValue());
        assertEquals("87654321", updatedAddress.getBody().get("dni"));
        assertEquals("SMOKE", updatedAddress.getBody().get("names"));
        assertEquals("Trujillo", updatedAddress.getBody().get("agency"));
        assertEquals("Jr. Lima 45", updatedAddress.getBody().get("address"));
        assertEquals("Cerca del mercado", updatedAddress.getBody().get("addressReference"));
        assertEquals(1, trujillo.getForObject(url("/api/clients/" + clientId + "/loans"), List.class).size(),
                "Updating a domicile must preserve the client's existing loans.");
        assertEquals(6, trujillo.getForObject(url("/api/loans/" + loanId + "/schedule"), List.class).size(),
                "Updating a domicile must preserve the full loan schedule.");
        assertEquals("Jr. Lima 45", admin.getForObject(url("/api/clients/" + clientId), Map.class).get("address"),
                "The administrator must see the updated domicile across agencies.");
        List<Map> trujilloLoans = admin.getForObject(url("/api/loans?agencyId=" + trujilloAgencyId), List.class);
        List<Map> chimboteLoans = admin.getForObject(url("/api/loans?agencyId=" + chimboteAgencyId), List.class);
        assertNotNull(trujilloLoans);
        assertNotNull(chimboteLoans);
        assertEquals(1, trujilloLoans.size(), "The administrator agency portfolio must contain one loan for this confirmation.");
        assertTrue(trujilloLoans.stream().anyMatch(l -> ((Number)l.get("id")).longValue() == loanId));
        assertTrue(chimboteLoans.stream().noneMatch(l -> ((Number)l.get("id")).longValue() == loanId));
        assertFalse(loanResponse.getBody().containsKey("insurance"), "The new-loan API must not expose insurance.");
        assertEquals(HttpStatus.NOT_FOUND, trujillo.getForEntity(url("/api/payments"), Map.class).getStatusCode(),
                "The standalone payments module must not be exposed by the API.");

        List<?> branchClients = chimbote.getForObject(url("/api/clients"), List.class);
        assertNotNull(branchClients);
        assertTrue(branchClients.stream().map(Map.class::cast).noneMatch(c -> "87654321".equals(c.get("dni"))),
                "A client registered in Trujillo must not appear in Chimbote's directory.");
        assertEquals(HttpStatus.FORBIDDEN, chimbote.getForEntity(url("/api/clients/" + clientId), Map.class).getStatusCode(),
                "An advisor must not retrieve another branch's client by direct ID.");
        assertEquals(HttpStatus.FORBIDDEN, chimbote.getForEntity(url("/api/loans/" + loanId + "/schedule"), Map.class).getStatusCode(),
                "An advisor must not retrieve another branch's loan schedule by direct ID.");
        assertEquals(HttpStatus.FORBIDDEN, chimbote.getForEntity(url("/api/loans?agencyId=" + trujilloAgencyId), Map.class).getStatusCode(),
                "An advisor must not query another branch using the agency filter.");
        assertEquals(HttpStatus.OK, admin.getForEntity(url("/api/dashboard/agencies"), List.class).getStatusCode());
        List<Map> agencyMetrics = admin.getForObject(url("/api/dashboard/agencies"), List.class);
        assertEquals(5, agencyMetrics.size());
        Map trujilloMetrics = agencyMetrics.stream().filter(branch -> ((Number)branch.get("id")).longValue() == trujilloAgencyId).findFirst().orElseThrow();
        Map chimboteMetrics = agencyMetrics.stream().filter(branch -> ((Number)branch.get("id")).longValue() == chimboteAgencyId).findFirst().orElseThrow();
        assertEquals(clients.countByAgency_Id(trujilloAgencyId), ((Number)trujilloMetrics.get("clients")).longValue(),
                "Agency dashboard client totals must match the directory count for that agency.");
        assertEquals(1L, ((Number)trujilloMetrics.get("activeLoans")).longValue());
        assertEquals(1200.0, ((Number)trujilloMetrics.get("portfolio")).doubleValue(), 0.001);
        assertEquals(0L, ((Number)chimboteMetrics.get("clients")).longValue());
        assertEquals(HttpStatus.BAD_REQUEST, admin.exchange(url("/api/loans"), HttpMethod.POST,
                new HttpEntity<>(request), Map.class).getStatusCode(),
                "An administrator without an assigned branch must not originate loans.");
    }

    @Test
    void clientsWithoutActiveLoansAreListedSeparatelyAndRemainAgencyScoped() {
        Agency trujilloAgency = agencies.findByName("Trujillo").orElseThrow();
        Agency piuraAgency = agencies.findByName("Piura").orElseThrow();
        AppUser trujilloAdvisor = users.findByUsername("asesor.trujillo").orElseThrow();
        Client noLoans = testClient("89000001", "NO", "LOANS", trujilloAgency);
        Client activeLoanClient = testClient("89000002", "ACTIVE", "LOAN", trujilloAgency);
        Client finishedLoanClient = testClient("89000003", "FINISHED", "LOAN", trujilloAgency);
        Client piuraNoLoans = testClient("89000004", "PIURA", "CLIENT", piuraAgency);
        clients.saveAllAndFlush(List.of(noLoans, activeLoanClient, finishedLoanClient, piuraNoLoans));
        fixtureClientIds.addAll(List.of(noLoans.id, activeLoanClient.id, finishedLoanClient.id, piuraNoLoans.id));

        Loan activeLoan = testLoan(activeLoanClient, trujilloAgency, trujilloAdvisor, "ACTIVO", "1000.00");
        Loan finishedLoan = testLoan(finishedLoanClient, trujilloAgency, trujilloAdvisor, "FINALIZADO", "0.00");
        loans.saveAllAndFlush(List.of(activeLoan, finishedLoan));
        fixtureLoanIds.addAll(List.of(activeLoan.id, finishedLoan.id));

        TestRestTemplate trujillo = rest.withBasicAuth("asesor.trujillo", "TestPass123!");
        TestRestTemplate piura = rest.withBasicAuth("asesor.piura", "TestPass123!");
        TestRestTemplate admin = rest.withBasicAuth("admin", "TestPass123!");
        List<Map> trujilloRows = trujillo.getForObject(url("/api/clients/without-active-loans"), List.class);
        assertNotNull(trujilloRows);
        assertTrue(containsClient(trujilloRows, noLoans.id));
        assertTrue(containsClient(trujilloRows, finishedLoanClient.id), "A client with only finalized loans must be listed.");
        assertFalse(containsClient(trujilloRows, activeLoanClient.id), "A client with an active loan must be excluded.");
        assertEquals(clients.findClientsWithoutActiveLoansByAgency(trujilloAgency.id).size(), trujilloRows.size());

        List<Map> piuraRows = piura.getForObject(url("/api/clients/without-active-loans"), List.class);
        assertNotNull(piuraRows);
        assertTrue(containsClient(piuraRows, piuraNoLoans.id));
        assertFalse(containsClient(piuraRows, noLoans.id), "An advisor must only see clients from their own agency.");
        assertEquals(HttpStatus.FORBIDDEN, trujillo.getForEntity(
                url("/api/clients/without-active-loans?agencyId=" + piuraAgency.id), Map.class).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, trujillo.getForEntity(url("/api/clients/" + piuraNoLoans.id), Map.class).getStatusCode(),
                "Direct client lookup must retain the existing branch access restriction.");

        List<Map> nationalRows = admin.getForObject(url("/api/clients/without-active-loans"), List.class);
        List<Map> filteredTrujilloRows = admin.getForObject(
                url("/api/clients/without-active-loans?agencyId=" + trujilloAgency.id), List.class);
        assertNotNull(nationalRows);
        assertTrue(containsClient(nationalRows, noLoans.id));
        assertTrue(containsClient(nationalRows, piuraNoLoans.id), "The administrator can see clients from every agency.");
        assertFalse(containsClient(nationalRows, activeLoanClient.id));
        assertTrue(containsClient(filteredTrujilloRows, finishedLoanClient.id));
        assertFalse(containsClient(filteredTrujilloRows, piuraNoLoans.id));
        assertEquals(HttpStatus.BAD_REQUEST, admin.exchange(url("/api/loans/evaluation"), HttpMethod.POST,
                new HttpEntity<>(Map.of("clientId", noLoans.id, "amount", "500", "installments", "6")), Map.class).getStatusCode(),
                "An administrator must not evaluate or originate a loan.");
    }

    private Client testClient(String dni, String names, String surnames, Agency agency) {
        Client client = new Client();
        client.dni = dni; client.names = names; client.surnames = surnames; client.agency = agency;
        return client;
    }

    private Loan testLoan(Client client, Agency agency, AppUser advisor, String status, String outstanding) {
        Loan loan = new Loan();
        loan.client = client; loan.agency = agency; loan.createdBy = advisor;
        loan.principal = new BigDecimal("1000.00"); loan.outstandingPrincipal = new BigDecimal(outstanding);
        loan.installments = 6; loan.disbursedAt = java.time.LocalDate.now(); loan.status = status;
        return loan;
    }

    private boolean containsClient(List<Map> rows, Long id) {
        return rows.stream().anyMatch(row -> id.equals(((Number) row.get("id")).longValue()));
    }

    private Map<String, Object> addressInput(String department, String province, String district, String ubigeo, String address, String reference) {
        return Map.of("department", department, "province", province, "district", district,
                "ubigeo", ubigeo, "address", address, "addressReference", reference);
    }

    private String url(String path) { return "http://localhost:" + port + path; }
}
