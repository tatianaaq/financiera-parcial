package pe.financiera.prestamos;

import jakarta.persistence.EntityManager;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Consulta nacional de SOLO LECTURA. No cambia las reglas de edición por sede
 * establecidas en Api.java y no expone domicilio ni teléfono entre agencias.
 * Se requiere autenticación para todos los endpoints /api/** (SecurityConfig).
 */
@RestController
@RequestMapping("/api/clients/national")
class NationalClientsController {
    private static final BigDecimal NATIONAL_LIMIT = new BigDecimal("10000.00");
    private final EntityManager entityManager;

    NationalClientsController(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @GetMapping
    @Transactional(readOnly = true)
    NationalClientResult byDni(@RequestParam String dni) {
        requireDni(dni);

        Client client = entityManager.createQuery(
                        "select c from Client c left join fetch c.agency where c.dni = :dni", Client.class)
                .setParameter("dni", dni)
                .setMaxResults(1)
                .getResultStream()
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No existe un cliente registrado con ese DNI."));

        List<Loan> loans = entityManager.createQuery(
                        "select l from Loan l join fetch l.agency where l.client.id = :clientId order by l.id desc",
                        Loan.class)
                .setParameter("clientId", client.id)
                .getResultList();

        List<Installment> installments = entityManager.createQuery(
                        "select i from Installment i where i.loan.client.id = :clientId", Installment.class)
                .setParameter("clientId", client.id)
                .getResultList();
        Map<Long, List<Installment>> byLoanId = installments.stream()
                .collect(Collectors.groupingBy(i -> i.loan.id));

        BigDecimal activeCapital = loans.stream()
                .filter(l -> "ACTIVO".equals(l.status))
                .map(l -> l.principal)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal available = NATIONAL_LIMIT.subtract(activeCapital).max(BigDecimal.ZERO);
        boolean overdue = loans.stream().filter(l -> "ACTIVO".equals(l.status))
                .flatMap(l -> byLoanId.getOrDefault(l.id, List.of()).stream())
                .anyMatch(i -> i.dueDate.isBefore(LocalDate.now()) && i.outstanding().signum() > 0);

        List<NationalLoanView> loanViews = loans.stream().map(l -> new NationalLoanView(
                l.id,
                l.agency.name,
                l.agency.id,
                l.principal,
                l.outstandingPrincipal,
                l.installments,
                l.disbursedAt,
                l.status
        )).toList();

        return new NationalClientResult(client.id, client.dni, client.names, client.surnames, client.active,
                client.agency == null ? "Sin agencia" : client.agency.name,
                client.agency == null ? null : client.agency.id,
                activeCapital, available, overdue, loanViews);
    }

    @GetMapping("/{dni}/loans/{loanId}/schedule")
    @Transactional(readOnly = true)
    List<NationalInstallmentView> schedule(@PathVariable String dni, @PathVariable Long loanId) {
        requireDni(dni);
        // La condición sobre DNI evita revelar cronogramas por simple enumeración de IDs.
        Loan loan = entityManager.createQuery(
                        "select l from Loan l join l.client c where l.id = :loanId and c.dni = :dni", Loan.class)
                .setParameter("loanId", loanId)
                .setParameter("dni", dni)
                .getResultStream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "No se encontró un préstamo asociado a ese DNI."));

        return entityManager.createQuery(
                        "select i from Installment i where i.loan.id = :loanId order by i.number",
                        Installment.class)
                .setParameter("loanId", loan.id)
                .getResultStream()
                .map(i -> new NationalInstallmentView(i.id, i.number, i.dueDate,
                        i.principalDue, i.interestDue, i.insuranceDue,
                        i.principalPaid.add(i.interestPaid).add(i.insurancePaid),
                        i.outstanding(), i.status))
                .toList();
    }

    private void requireDni(String dni) {
        if (dni == null || !dni.matches("\\d{8}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ingresa un DNI de exactamente 8 dígitos.");
        }
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> handleLookupError(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of(
                "error", e.getReason() == null ? "No se pudo completar la consulta." : e.getReason()));
    }
}

record NationalLoanView(Long id, String agency, Long agencyId, BigDecimal principal,
                        BigDecimal outstandingPrincipal, int installments, LocalDate disbursedAt, String status) {}

record NationalClientResult(Long id, String dni, String names, String surnames, boolean active,
                            String agency, Long agencyId, BigDecimal activeOriginalCapital,
                            BigDecimal availableOriginalCapital, boolean hasOverdueInstallments,
                            List<NationalLoanView> loans) {}

record NationalInstallmentView(Long id, int number, LocalDate dueDate, BigDecimal principal,
                               BigDecimal interest, BigDecimal insurance, BigDecimal paid,
                               BigDecimal outstanding, String status) {}
