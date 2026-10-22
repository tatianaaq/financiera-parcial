package pe.financiera.prestamos;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Una evaluación no escribe créditos. Requiere aceptación y coinciden cronograma previo/final. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT, properties={
    "spring.datasource.url=jdbc:h2:mem:loan_proposal_acceptance;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.jpa.hibernate.ddl-auto=create-drop", "spring.flyway.enabled=false",
    "app.seed.enabled=true", "app.seed-password=TestPass123!", "app.admin.password=TestPass123!", "dni.api.key="
})
class LoanProposalAcceptanceTest {
    @Autowired AgencyRepository agencies;
    @Autowired ClientRepository clients;
    @Autowired LoanRepository loans;
    @Autowired InstallmentRepository installments;
    @Autowired TestRestTemplate rest;
    @LocalServerPort int port;
    static final AtomicInteger SEQ = new AtomicInteger(1);
    Long clientId;
    TestRestTemplate advisor(){return rest.withBasicAuth("asesor.trujillo","TestPass123!");}
    String url(String path){return "http://localhost:"+port+path;}
    Map<String,Object> proposal(){return Map.of("clientId",clientId,"amount","900","installments","3");}

    @BeforeEach void newClient() {
        Client client = new Client();
        client.dni=String.format("93%06d",SEQ.getAndIncrement());
        client.names="PRUEBA";client.surnames="ACEPTACION";
        client.agency=agencies.findByName("Trujillo").orElseThrow();
        clientId=clients.saveAndFlush(client).id;
    }

    @Test void evaluationProvidesCompleteRealScheduleAndMatchesSavedLoan() {
        ResponseEntity<Map> evaluation=advisor().postForEntity(url("/api/loans/evaluation"),proposal(),Map.class);
        assertEquals(200,evaluation.getStatusCode().value(),evaluation.toString());
        Map body=Objects.requireNonNull(evaluation.getBody());
        List<Map> quoted=(List<Map>)body.get("schedulePreview");
        assertEquals(3,quoted.size());
        LocalDate origination=LocalDate.parse((String)body.get("quoteDate"));
        BigDecimal quotedTotal=BigDecimal.ZERO;
        for(int n=1;n<=3;n++){
            Map item=quoted.get(n-1);
            assertEquals(n,((Number)item.get("number")).intValue());
            assertEquals(origination.plusDays(30L*n-1).toString(),item.get("dueDate"));
            quotedTotal=quotedTotal.add(new BigDecimal(item.get("total").toString()));
        }
        assertEquals(0,quotedTotal.compareTo(new BigDecimal(body.get("totalPaymentEstimate").toString())));
        assertTrue(loans.findByClientIdOrderByIdDesc(clientId).isEmpty(),"Evaluar no registra préstamos");

        Map<String,Object> accepted=new LinkedHashMap<>(proposal());
        accepted.put("customerAccepted",true);
        accepted.put("quoteDate",body.get("quoteDate"));
        ResponseEntity<Map> confirmed=advisor().postForEntity(url("/api/loans"),accepted,Map.class);
        assertEquals(200,confirmed.getStatusCode().value(),confirmed.toString());
        Long loanId=((Number)Objects.requireNonNull(confirmed.getBody()).get("id")).longValue();
        assertNotNull(loans.findById(loanId).orElseThrow().acceptanceRecordedAt);
        List<Installment> rows=installments.findByLoanIdOrderByNumber(loanId);
        assertEquals(quoted.size(),rows.size());
        for(int n=0;n<rows.size();n++){
            Map item=quoted.get(n);Installment actual=rows.get(n);
            assertEquals(item.get("dueDate"),actual.dueDate.toString());
            assertEquals(0,actual.principalDue.compareTo(new BigDecimal(item.get("principal").toString())));
            assertEquals(0,actual.interestDue.compareTo(new BigDecimal(item.get("interest").toString())));
            assertEquals(0,actual.outstanding().compareTo(new BigDecimal(item.get("total").toString())));
        }
    }

    @Test void loanWithoutAcceptanceOrWithStaleQuoteIsRejectedWithoutWriting() {
        Map<String,Object> input=new LinkedHashMap<>(proposal());
        input.put("quoteDate",LoanCalendar.todayInLima().toString());
        assertEquals(400,advisor().postForEntity(url("/api/loans"),input,Map.class).getStatusCode().value());
        input.put("customerAccepted",false);
        assertEquals(400,advisor().postForEntity(url("/api/loans"),input,Map.class).getStatusCode().value());
        input.put("customerAccepted",true);
        input.put("quoteDate",LoanCalendar.todayInLima().minusDays(1).toString());
        assertEquals(400,advisor().postForEntity(url("/api/loans"),input,Map.class).getStatusCode().value());
        assertTrue(loans.findByClientIdOrderByIdDesc(clientId).isEmpty());
    }
}
