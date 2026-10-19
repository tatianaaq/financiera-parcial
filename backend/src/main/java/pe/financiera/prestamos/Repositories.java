package pe.financiera.prestamos;

import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.*;

interface AgencyRepository extends JpaRepository<Agency,Long>{ Optional<Agency> findByName(String name); }
interface UserRepository extends JpaRepository<AppUser,Long>{ Optional<AppUser> findByUsername(String username); List<AppUser> findAllByRole(String role); boolean existsByAgency_IdAndRole(Long agencyId,String role); }
interface ClientRepository extends JpaRepository<Client,Long>{
 Optional<Client> findByIdAndAgency_Id(Long id,Long agencyId);
 boolean existsByDni(String dni);
 @Query("select c from Client c where c.agency.id=:agencyId and c.dni=:dni") Optional<Client> findForAgency(@Param("agencyId") Long agencyId,@Param("dni") String dni);
 @Query("select c from Client c where c.agency.id=:agencyId and (lower(c.dni) like lower(concat('%',:q,'%')) or lower(c.names) like lower(concat('%',:q,'%')) or lower(c.surnames) like lower(concat('%',:q,'%'))) order by c.id desc") List<Client> searchForAgency(@Param("agencyId") Long agencyId,@Param("q") String q);
 List<Client> findAllByAgency_IdOrderByIdDesc(Long agencyId);
 @Query("select c from Client c where not exists (select l.id from Loan l where l.client.id=c.id and l.status='ACTIVO') order by c.id desc")
 List<Client> findClientsWithoutActiveLoans();
 @Query("select c from Client c where c.agency.id=:agencyId and not exists (select l.id from Loan l where l.client.id=c.id and l.status='ACTIVO') order by c.id desc")
 List<Client> findClientsWithoutActiveLoansByAgency(@Param("agencyId") Long agencyId);
 long countByAgency_Id(Long agencyId);
 @Query("select count(c)>0 from Client c where c.id=:clientId and c.agency.id=:agencyId") boolean belongsToAgency(@Param("clientId") Long clientId,@Param("agencyId") Long agencyId);
 @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select c from Client c where c.id=:id") Optional<Client> findByIdForUpdate(@Param("id") Long id);
}
interface LoanRepository extends JpaRepository<Loan,Long>{
 @EntityGraph(attributePaths={"client","agency","createdBy"}) List<Loan> findAllByOrderByIdDesc();
 @EntityGraph(attributePaths={"client","agency","createdBy"}) List<Loan> findByAgencyIdOrderByIdDesc(Long agencyId);
 @Query("select coalesce(sum(l.outstandingPrincipal),0) from Loan l where l.client.id=:id and l.status='ACTIVO'") java.math.BigDecimal pendingCapital(@Param("id") Long id);
 @Query("select coalesce(sum(l.outstandingPrincipal),0) from Loan l where l.client.dni=:dni and l.status='ACTIVO'") java.math.BigDecimal pendingCapitalByDni(@Param("dni") String dni);
 @Query("select coalesce(sum(l.principal),0) from Loan l where l.client.dni=:dni and l.status='ACTIVO'") java.math.BigDecimal pendingOriginalCapitalByDni(@Param("dni") String dni);
 @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select l from Loan l where l.id=:id") Optional<Loan> findByIdForUpdate(@Param("id") Long id);
 List<Loan> findByClientIdAndStatus(Long clientId,String status);
 List<Loan> findByClientIdOrderByIdDesc(Long clientId);
 @Query("select l from Loan l where l.client.dni=:dni and l.status=:status") List<Loan> findByClientDniAndStatus(@Param("dni") String dni,@Param("status") String status);
 @Query("select l from Loan l where l.client.id=:clientId and l.agency.id=:agencyId order by l.id desc") List<Loan> findByClientAndAgency(@Param("clientId") Long clientId,@Param("agencyId") Long agencyId);
}
interface InstallmentRepository extends JpaRepository<Installment,Long>{ List<Installment> findByLoanIdOrderByNumber(Long loanId); List<Installment> findByLoanIdInOrderByDueDate(Collection<Long> ids); }
interface PaymentRepository extends JpaRepository<Payment,Long>{ List<Payment> findAllByOrderByIdDesc(); List<Payment> findByLoanIdOrderByPaidAtDesc(Long id); boolean existsByMethodAndReference(String method,String reference); }
interface AllocationRepository extends JpaRepository<PaymentAllocation,Long>{}
