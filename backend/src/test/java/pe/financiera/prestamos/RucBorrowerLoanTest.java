package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
        "spring.datasource.url=jdbc:h2:mem:ruc_borrower_tests;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
        "spring.jpa.hibernate.ddl-auto=create-drop","spring.flyway.enabled=false",
        "app.seed.enabled=true","app.seed-password=TestPass123!","app.admin.password=TestPass123!","dni.api.key=","elruc.api.key="
})
class RucBorrowerLoanTest {
    @Autowired AgencyRepository agencies;
    @Autowired ClientRepository clients;
    @Autowired CompanyRepository companies;
    @Autowired DocumentLinkRepository links;
    @Autowired UserRepository users;
    @Autowired TestRestTemplate rest;
    @LocalServerPort int port;
    private static final AtomicInteger COUNTER=new AtomicInteger(1);

    static String validRuc10(String dni){
        String first="10"+dni;
        int[] weights={5,4,3,2,7,6,5,4,3,2};int sum=0;
        for(int i=0;i<10;i++)sum+=(first.charAt(i)-'0')*weights[i];
        return first+((11-sum%11)%10);
    }
    Client person(){
        Client client=new Client();client.dni=String.format("76%06d",COUNTER.getAndIncrement());
        client.names="REPRESENTANTE";client.surnames="PRUEBA";
        client.agency=agencies.findByName("Trujillo").orElseThrow();
        return clients.saveAndFlush(client);
    }
    Map loanPayload(Client client,String type,String document,String amount){
        return Map.of("clientId",client.id,"amount",amount,"installments","6",
                "documentType",type,"documentNumber",document,"customerAccepted",true,"quoteDate",LoanCalendar.todayInLima().toString());
    }
    ResponseEntity<Map> post(String agency,String path,Map payload){
        return rest.withBasicAuth("asesor."+agency,"TestPass123!")
                .postForEntity("http://localhost:"+port+path,payload,Map.class);
    }
    DocumentLink createLink(Client client,String type,String ruc,Company company){
        DocumentLink link=new DocumentLink();link.documentType=type;link.documentNumber=ruc;
        link.client=client;link.company=company;link.checkedAt=Instant.now();link.documentsReviewed=true;
        link.representativeName="REPRESENTANTE PRUEBA";link.representativeRole="Gerente General";
        link.checkedBy=users.findByUsername("asesor.trujillo").orElseThrow();
        return links.saveAndFlush(link);
    }
    @Test void loansPreserveCompanyAsBorrowerButShareNationalLimitAcrossDniAndBothRucTypes(){
        Client client=person();
        String ruc20="20421239275",ruc10=validRuc10(client.dni);
        assertTrue(RucLookupController.isValidRuc(ruc10));
        Company company=new Company();company.ruc=ruc20;company.legalName="EMPRESA DE PRUEBA S.A.C.";
        company=companies.saveAndFlush(company);
        createLink(client,"RUC10",ruc10,null);
        createLink(client,"RUC20",ruc20,company);
        ResponseEntity<Map> personal=post("trujillo","/api/loans",loanPayload(client,"DNI",client.dni,"5000"));
        assertEquals(200,personal.getStatusCode().value(),personal.toString());
        ResponseEntity<Map> business=post("piura","/api/loans",loanPayload(client,"RUC20",ruc20,"4000"));
        assertEquals(200,business.getStatusCode().value(),business.toString());
        assertEquals("RUC20",business.getBody().get("documentType"));
        assertEquals(ruc20,business.getBody().get("borrowerDocument"));
        assertEquals(client.dni,business.getBody().get("responsibleDni"));
        assertEquals("EMPRESA DE PRUEBA S.A.C.",business.getBody().get("client"));
        ResponseEntity<Map> owner=post("tumbes","/api/loans",loanPayload(client,"RUC10",ruc10,"1000"));
        assertEquals(200,owner.getStatusCode().value(),owner.toString());
        ResponseEntity<Map> denied=post("chiclayo","/api/loans",loanPayload(client,"DNI",client.dni,"1"));
        assertEquals(400,denied.getStatusCode().value(),denied.toString());
    }
    @Test void doesNotAllowSpoofingAnotherOwnersDocumentOrUnlinkedRuc(){
        Client client=person();String ruc20="20421239275";
        ResponseEntity<Map> unlinked=post("chimbote","/api/loans/evaluation",loanPayload(client,"RUC20",ruc20,"100"));
        assertEquals(400,unlinked.getStatusCode().value(),unlinked.toString());
        ResponseEntity<Map> fakeDni=post("chimbote","/api/loans",loanPayload(client,"DNI","12345678","100"));
        assertEquals(400,fakeDni.getStatusCode().value(),fakeDni.toString());
    }
    @Test void representativeNameMustMatchVerifiedIdentityRegardlessOfOrderAndAccents(){
        assertTrue(RucDocumentLinksController.tokensEqual("PÉREZ SORIA LUIS JOSÉ","JOSE LUIS SORIA PEREZ"));
        assertFalse(RucDocumentLinksController.tokensEqual("PÉREZ JUAN","SORIA JUAN"));
    }
}
