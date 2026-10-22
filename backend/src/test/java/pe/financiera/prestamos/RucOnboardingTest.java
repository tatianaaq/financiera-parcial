package pe.financiera.prestamos;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:h2:mem:ruc_onboarding_test;DB_CLOSE_DELAY=-1;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.jpa.hibernate.ddl-auto=create-drop","spring.flyway.enabled=false",
    "app.seed.enabled=true","app.seed-password=TestPass123!","app.admin.password=TestPass123!",
    "dni.api.key=", "elruc.api.key="
})
class RucOnboardingTest {
    @MockitoBean RucLookupController rucProvider;
    @MockitoBean DniVerificationService dniVerifier;
    @Autowired TestRestTemplate rest;
    @Autowired ObjectMapper mapper;
    @Autowired ClientRepository clients;
    @Autowired CompanyRepository companies;
    @Autowired DocumentLinkRepository links;
    @LocalServerPort int port;

    ResponseEntity<Map> onboard(Map<String,Object> request) {
        return rest.withBasicAuth("asesor.trujillo","TestPass123!")
            .postForEntity("http://localhost:"+port+"/api/ruc/onboard",request,Map.class);
    }

    @Test void createsMissingPersonCompanyAndLinkInSingleRequest() throws Exception {
        String ruc="20421239275",dni="62872190";
        when(rucProvider.find(ruc)).thenReturn(mapper.readTree("""
          {"ruc":"20421239275","estado":"ACTIVO","razon_social":"EMPRESA LABORATORIO S.A.C.",
           "representantes":[{"nombre":"PEREZ DIAZ MARIA ELENA","cargo":"GERENTE GENERAL"}]}
        """));
        when(dniVerifier.verifyForOnboarding(eq(dni),any(AppUser.class)))
            .thenReturn(new VerifiedIdentity(dni,"MARIA ELENA","PEREZ","DIAZ"));
        ResponseEntity<Map> response=onboard(Map.of("documentType","RUC20","documentNumber",ruc,
            "responsibleDni",dni,"representativeName","PEREZ DIAZ MARIA ELENA","documentsReviewed",true));
        assertEquals(200,response.getStatusCode().value(),response.toString());
        assertEquals(dni,response.getBody().get("responsibleDni"));
        assertEquals("EMPRESA LABORATORIO S.A.C.",response.getBody().get("borrowerName"));
        assertTrue(clients.findByDni(dni).isPresent());
        assertTrue(companies.findByRuc(ruc).isPresent());
        assertTrue(links.findByDocumentNumber(ruc).isPresent());
        // Segunda solicitud del mismo documento no debe registrar duplicados.
        assertEquals(200,onboard(Map.of("documentType","RUC20","documentNumber",ruc,
            "responsibleDni",dni,"representativeName","PEREZ DIAZ MARIA ELENA","documentsReviewed",true)).getStatusCode().value());
        assertEquals(1,clients.findAll().stream().filter(c->dni.equals(c.dni)).count());
        assertEquals(409,onboard(Map.of("documentType","RUC20","documentNumber",ruc,
            "responsibleDni","71625390","representativeName","PEREZ DIAZ MARIA ELENA",
            "documentsReviewed",true)).getStatusCode().value());
    }

    @Test void automaticallyCreatesRuc10HolderWithoutCompany() throws Exception {
        String dni="71826390",ruc=RucBorrowerLoanTest.validRuc10(dni);
        when(rucProvider.find(ruc)).thenReturn(mapper.readTree(
            "{\"ruc\":\""+ruc+"\",\"estado\":\"ACTIVO\"}"));
        when(dniVerifier.verifyForOnboarding(eq(dni),any(AppUser.class)))
            .thenReturn(new VerifiedIdentity(dni,"CAMILA","RUIZ","MENDOZA"));
        ResponseEntity<Map> response=onboard(Map.of("documentType","RUC10","documentNumber",ruc,
            "responsibleDni",dni,"documentsReviewed",true));
        assertEquals(200,response.getStatusCode().value(),response.toString());
        assertEquals("RUC10",response.getBody().get("documentType"));
        assertEquals(dni,response.getBody().get("responsibleDni"));
        assertTrue(clients.findByDni(dni).isPresent());
        assertNull(links.findByDocumentNumber(ruc).orElseThrow().company);
    }

    @Test void refusesWrongDniForRuc10BeforeCallingExternalProvider(){
        String ruc=RucBorrowerLoanTest.validRuc10("70916714");
        ResponseEntity<Map> response=onboard(Map.of("documentType","RUC10","documentNumber",ruc,
            "responsibleDni","70916715","documentsReviewed",true));
        assertEquals(400,response.getStatusCode().value());
        verifyNoInteractions(dniVerifier);
    }

    @Test void representativeMismatchDoesNotCreatePersonOrCompany() throws Exception {
        String ruc="20603498799",dni="64782413";
        when(rucProvider.find(ruc)).thenReturn(mapper.readTree("""
          {"ruc":"20603498799","estado":"ACTIVO","razon_social":"EMPRESA DIFERENTE S.A.C.",
           "representantes":[{"nombre":"PEREZ DIAZ MARIA ELENA","cargo":"GERENTE GENERAL"}]}
        """));
        when(dniVerifier.verifyForOnboarding(eq(dni),any(AppUser.class)))
            .thenReturn(new VerifiedIdentity(dni,"PEDRO","SOTO","RIVERA"));
        ResponseEntity<Map> response=onboard(Map.of("documentType","RUC20","documentNumber",ruc,
            "responsibleDni",dni,"representativeName","PEREZ DIAZ MARIA ELENA","documentsReviewed",true));
        assertEquals(400,response.getStatusCode().value(),response.toString());
        assertTrue(clients.findByDni(dni).isEmpty());
        assertTrue(links.findByDocumentNumber(ruc).isEmpty());
    }
}
