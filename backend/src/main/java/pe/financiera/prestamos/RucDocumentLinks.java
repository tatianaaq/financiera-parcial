package pe.financiera.prestamos;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.text.Normalizer;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

record RucLinkInput(
        @NotBlank String documentType,
        @NotBlank String documentNumber,
        @NotNull Long clientId,
        @NotBlank String verificationId,
        String representativeName,
        @AssertTrue(message="Debes revisar físicamente el DNI y la documentación vigente de representación.") boolean documentsReviewed
) {}
/** Alta de persona (si no existe) + empresa + vínculo en una sola operación atómica. */
record RucOnboardingInput(
        @NotBlank String documentType,
        @NotBlank String documentNumber,
        @NotBlank @Pattern(regexp="[0-9]{8}") String responsibleDni,
        String representativeName,
        @AssertTrue(message="El asesor debe comprobar DNI, documentos y facultades aplicables.") boolean documentsReviewed
) {}
record RucLinkView(Long id, String documentType, String documentNumber, Long clientId, String responsibleDni,
                   String responsibleName, String borrowerName, String representativeName, String representativeRole,
                   Instant checkedAt) {}

/** El proveedor RUC confirma registros; el asesor acredita en persona los documentos y facultades. */
@RestController
@RequestMapping("/api/ruc")
class RucDocumentLinksController {
    private final RucLookupController lookup;
    private final DniVerificationService identity;
    private final DocumentLinkRepository links;
    private final CompanyRepository companies;
    private final ClientRepository clients;
    private final UserRepository users;

    RucDocumentLinksController(RucLookupController lookup,DniVerificationService identity,
            DocumentLinkRepository links, CompanyRepository companies, ClientRepository clients,UserRepository users) {
        this.lookup=lookup;this.identity=identity;this.links=links;this.companies=companies;this.clients=clients;this.users=users;
    }
    AppUser actor(Authentication auth) {
        AppUser user=users.findByUsername(auth.getName()).orElseThrow();
        if (!"ADVISOR".equals(user.role)||user.agency==null||!user.agency.enabled)
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Solo un asesor de una agencia habilitada puede vincular documentos.");
        return user;
    }
    @PostMapping("/identity-lookup")
    DniLookupResult verifyExistingDni(@Valid @RequestBody DniLookupInput input,Authentication auth){
        return identity.lookupForAssociation(input.dni(),actor(auth));
    }

    /** Directorio de documentos RUC vinculados; asesores solo ven su sede. */
    @GetMapping("/directory") @Transactional(readOnly=true)
    List<RucLinkView> directory(Authentication auth) {
        AppUser user = users.findByUsername(auth.getName()).orElseThrow();
        if (!user.enabled) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Usuario deshabilitado.");
        boolean admin = "ADMIN".equals(user.role);
        if (!admin && (!"ADVISOR".equals(user.role) || user.agency == null || !user.agency.enabled))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No puedes consultar este directorio.");
        return links.findAll().stream()
                .filter(link -> admin || (link.client.agency != null && Objects.equals(link.client.agency.id, user.agency.id)))
                .sorted(Comparator.comparing((DocumentLink link) -> link.checkedAt).reversed())
                .map(this::view).toList();
    }

    @GetMapping("/links/{ruc}") @Transactional(readOnly=true)
    RucLinkView savedLink(@PathVariable String ruc,Authentication auth){
        // Lectura nacional permitida a usuarios autenticados; escritura solo a asesores.
        users.findByUsername(auth.getName()).orElseThrow();
        if(!RucLookupController.isValidRuc(ruc))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"RUC inválido.");
        return view(links.findByDocumentNumber(ruc).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"El RUC no tiene una vinculación verificada.")));
    }

    /**
     * Flujo único: el asesor elige el representante, revisa documentos y continúa.
     * No se obliga al asesor a registrar primero la persona en otro formulario.
     * Si ya existe se reutiliza; si no, se crea con identidad consultada en JSON.pe.
     * Datos de contacto no comprobados NO se inventan y quedan pendientes de completar.
     */
    @PostMapping("/onboard") @Transactional
    RucLinkView onboard(@Valid @RequestBody RucOnboardingInput input, Authentication auth) {
        AppUser user = actor(auth);
        String type = input.documentType(), ruc = input.documentNumber();
        String dni = input.responsibleDni();
        if (!type.equals("RUC10") && !type.equals("RUC20"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona RUC 10 o RUC 20.");
        if (!RucLookupController.isValidRuc(ruc) || !ruc.startsWith(type.equals("RUC10") ? "10" : "20"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"RUC inválido.");
        if (type.equals("RUC10") && !ruc.substring(2,10).equals(dni))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El RUC 10 no corresponde al DNI del titular.");

        DocumentLink previous = links.findByDocumentNumber(ruc).orElse(null);
        if (previous != null) {
            if (!previous.client.dni.equals(dni))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "Este RUC ya tiene otro DNI responsable. Requiere revisión administrativa.");
            if (!previous.client.active)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El DNI responsable está inactivo.");
            return view(previous); // vinculación anterior: evita duplicar empresa y persona
        }

        JsonNode data = lookup.find(ruc);
        String status = data.path("estado").asText("");
        if (!"ACTIVO".equalsIgnoreCase(status))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El RUC debe estar ACTIVO.");

        JsonNode selected = null;
        String repName = null, repRole = null, legalName = null;
        if (type.equals("RUC20")) {
            legalName = data.path("razon_social").asText("").trim();
            if (legalName.isBlank())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El proveedor no devolvió razón social.");
            if (input.representativeName() == null || input.representativeName().isBlank())
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona un representante.");
            for (JsonNode row : data.path("representantes")) {
                if (tokensEqual(row.path("nombre").asText(), input.representativeName())) {
                    selected = row;
                    break;
                }
            }
            if (selected == null)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El representante no figura en el RUC consultado.");
            repName = selected.path("nombre").asText();
            repRole = selected.path("cargo").asText("");
            String publishedDni = selected.path("numero_documento").asText("").trim();
            if (publishedDni.matches("[0-9]{8}") && !publishedDni.equals(dni))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El DNI difiere del publicado para ese representante.");
        }

        // Una consulta de identidad por alta; el asesor no tiene que hacer otra búsqueda.
        VerifiedIdentity verified = identity.verifyForOnboarding(dni, user);
        if (type.equals("RUC20") && !tokensEqual(repName, verified.names() + " " + verified.surnames()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "El DNI consultado no coincide con el representante elegido.");

        Client person = clients.findByDni(dni).orElse(null);
        if (person != null) {
            if (!person.active)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El DNI responsable está inactivo.");
            if (!tokensEqual(person.names + " " + person.surnames, verified.names() + " " + verified.surnames()))
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "El nombre del cliente existente no coincide con la identidad verificada.");
        } else {
            person = new Client();
            person.agency = user.agency;
            person.dni = verified.dni();
            person.names = verified.names();
            person.surnames = verified.surnames();
            // Teléfono, domicilio y UBIGEO se completarán con datos declarados; no fabricarlos.
            person = clients.saveAndFlush(person);
        }

        Company company = null;
        if (type.equals("RUC20")) {
            final String registeredName = legalName;
            company = companies.findByRuc(ruc).orElseGet(() -> {
                Company c = new Company(); c.ruc = ruc; c.legalName = registeredName; c.taxStatus = status;
                return companies.saveAndFlush(c);
            });
            company.legalName = legalName;
            company.taxStatus = status;
        }
        // Un índice UNIQUE(document_number) impide vinculación duplicada entre agencias.
        DocumentLink link = new DocumentLink();
        link.documentType = type; link.documentNumber = ruc; link.client = person;
        link.company = company; link.representativeName = repName; link.representativeRole = repRole;
        link.documentsReviewed = true; link.checkedAt = Instant.now(); link.checkedBy = user;
        return view(links.saveAndFlush(link));
    }

    @PostMapping("/links") @Transactional
    RucLinkView link(@Valid @RequestBody RucLinkInput input, Authentication auth) {
        AppUser user=actor(auth);
        String type=input.documentType(),ruc=input.documentNumber();
        if(!type.equals("RUC10")&&!type.equals("RUC20"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Selecciona RUC10 o RUC20.");
        if(!RucLookupController.isValidRuc(ruc)||!ruc.startsWith(type.equals("RUC10")?"10":"20"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"RUC inválido.");
        Client person=clients.findByIdForUpdate(input.clientId()).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Primero registra al DNI responsable."));
        if(!person.active)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"DNI responsable inactivo.");
        // El ticket se obtiene mediante consulta reciente al proveedor de identidad, incluso para clientes existentes.
        VerifiedIdentity verified=identity.consume(input.verificationId(),person.dni,user);
        if(!tokensEqual(verified.names()+" "+verified.surnames(),person.names+" "+person.surnames))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"La identidad consultada no coincide con el DNI registrado.");
        if(type.equals("RUC10")&&!ruc.substring(2,10).equals(person.dni))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El RUC 10 no corresponde al DNI de su titular.");
        // Revalidar con el proveedor en servidor, nunca confiar en el nombre de empresa enviado por el navegador.
        JsonNode data=lookup.find(ruc);
        String status=data.path("estado").asText("");
        if(!status.equalsIgnoreCase("ACTIVO"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El RUC debe estar ACTIVO para vincularlo.");
        Company company=null;String name=null,role=null;
        if(type.equals("RUC20")){
            String legalName=data.path("razon_social").asText("").trim();
            if(legalName.isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El proveedor no devolvió razón social.");
            if(input.representativeName()==null||input.representativeName().isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Elige un representante legal.");
            JsonNode selected=null;
            for(JsonNode row:data.path("representantes")){
                if(tokensEqual(row.path("nombre").asText(),input.representativeName())){ selected=row;break; }
            }
            if(selected==null)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El representante no figura en la consulta de RUC.");
            name=selected.path("nombre").asText();role=selected.path("cargo").asText("");
            if(!tokensEqual(name,verified.names()+" "+verified.surnames()))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El nombre del representante no coincide con el DNI verificado. Comprueba los documentos.");
            company=companies.findByRuc(ruc).orElseGet(()->{Company c=new Company();c.ruc=ruc;c.legalName=legalName;c.taxStatus=status;return companies.saveAndFlush(c);});
            company.legalName=legalName;company.taxStatus=status;
        }
        DocumentLink saved=links.findByDocumentNumber(ruc).orElse(null);
        if(saved!=null&&!saved.client.id.equals(person.id))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Este RUC ya tiene otro DNI responsable. La reasignación requiere revisión administrativa auditada.");
        if(saved==null)saved=new DocumentLink();
        saved.documentType=type;saved.documentNumber=ruc;saved.client=person;saved.company=company;
        saved.representativeName=name;saved.representativeRole=role;saved.documentsReviewed=true;
        saved.checkedAt=Instant.now();saved.checkedBy=user;
        return view(links.saveAndFlush(saved));
    }

    static boolean tokensEqual(String first,String second){
        return tokens(first).equals(tokens(second))&&!tokens(first).isEmpty();
    }
    static List<String> tokens(String text){
        if(text==null)return List.of();
        String normalized=Normalizer.normalize(text,Normalizer.Form.NFD).replaceAll("\\p{M}","")
                .toUpperCase(Locale.ROOT).replaceAll("[^A-Z ]"," ").trim();
        return Arrays.stream(normalized.split("\\s+")).filter(t->!t.isBlank()).sorted().collect(Collectors.toList());
    }
    RucLinkView view(DocumentLink link){
        return new RucLinkView(link.id,link.documentType,link.documentNumber,link.client.id,link.client.dni,
                link.client.names+" "+link.client.surnames,link.company==null?link.client.names+" "+link.client.surnames:link.company.legalName,
                link.representativeName,link.representativeRole,link.checkedAt);
    }
    @ExceptionHandler({ResponseStatusException.class,DniLookupException.class,DataIntegrityViolationException.class})
    ResponseEntity<Map<String,String>> friendlyErrors(RuntimeException error){
        if(error instanceof ResponseStatusException e)return ResponseEntity.status(e.getStatusCode()).body(Map.of("error",e.getReason()==null?"La operación fue rechazada.":e.getReason()));
        if(error instanceof DniLookupException e)return ResponseEntity.status(e.status).body(Map.of("error",e.getMessage()));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error","Este documento ya está vinculado. Actualiza la consulta y vuelve a intentarlo."));
    }
}
