package pe.financiera.prestamos;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity @Table(name="agencies") class Agency {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(nullable=false,unique=true) String name;
 boolean enabled=true;
 Agency(){} Agency(String name){this.name=name;}
 public Long getId(){return id;}
 public String getName(){return name;}
}
@Entity @Table(name="app_users",uniqueConstraints=@UniqueConstraint(name="uk_user_agency_role",columnNames={"agency_id","role"})) class AppUser {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(nullable=false,unique=true) String username;
 @Column(nullable=false) String password;
 @Column(nullable=false) String role;
 @ManyToOne(fetch=FetchType.EAGER) Agency agency;
 boolean enabled=true;
 AppUser(){}
 AppUser(String u,String p,String r,Agency a){username=u;password=p;role=r;agency=a;}
}
@Entity @Table(name="clients",uniqueConstraints={@UniqueConstraint(name="uk_client_agency_dni",columnNames={"agency_id","dni"}),@UniqueConstraint(name="uk_client_dni_global",columnNames={"dni"})}) class Client {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @ManyToOne(fetch=FetchType.LAZY) Agency agency;
 @Column(nullable=false,length=8) String dni;
 @Column(nullable=false) String names;
 @Column(nullable=false) String surnames;
 String phone; String address;
 @Column(length=80) String department;
 @Column(length=80) String province;
 @Column(length=80) String district;
 @Column(length=6) String ubigeo;
 @Column(name="address_reference",length=200) String addressReference;
 LocalDate registeredAt=LocalDate.now(); boolean active=true;
 Client(){}
}
@Entity @Table(name="loans") class Loan {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @ManyToOne(optional=false) Client client;
 @ManyToOne(optional=false) Agency agency;
 @ManyToOne(optional=false) AppUser createdBy;
 // El cliente es SIEMPRE el DNI responsable para el control nacional de riesgo.
 @Column(name="document_type",nullable=false,length=5) String documentType="DNI";
 @Column(name="borrower_document",nullable=false,length=11) String borrowerDocument;
 @Column(name="responsible_dni",nullable=false,length=8) String responsibleDni;
 @Column(name="borrower_name",length=255) String borrowerName;
 @Column(name="representative_name",length=180) String representativeName;
 @Column(name="representative_role",length=120) String representativeRole;
 @ManyToOne @JoinColumn(name="company_id") Company company;
 @ManyToOne @JoinColumn(name="document_link_id") DocumentLink documentLink;
 BigDecimal principal; BigDecimal outstandingPrincipal; BigDecimal annualRate=new BigDecimal("0.30");
 int installments; boolean insurance; LocalDate disbursedAt;
 /** Marca temporal de aceptación comunicada por el asesor; no es firma contractual. */
 @Column(name="acceptance_recorded_at") java.time.Instant acceptanceRecordedAt;
 @Column(nullable=false) String status="ACTIVO";
 Loan(){}
 @PrePersist void ensureLegacyDniIdentity(){
  if(client!=null){
   if(documentType==null)documentType="DNI";
   if(borrowerDocument==null)borrowerDocument=client.dni;
   if(responsibleDni==null)responsibleDni=client.dni;
   if(borrowerName==null)borrowerName=client.names+" "+client.surnames;
  }
 }
}
@Entity @Table(name="installments") class Installment {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @ManyToOne(optional=false) Loan loan;
 int number; LocalDate dueDate;
 BigDecimal principalDue, interestDue, insuranceDue;
 BigDecimal principalPaid=BigDecimal.ZERO, interestPaid=BigDecimal.ZERO, insurancePaid=BigDecimal.ZERO;
 String status="PENDIENTE";
 Installment(){}
 BigDecimal outstanding(){return principalDue.subtract(principalPaid).add(interestDue.subtract(interestPaid)).add(insuranceDue.subtract(insurancePaid));}
}
@Entity @Table(name="payments",uniqueConstraints=@UniqueConstraint(name="uk_payment_method_reference",columnNames={"method","reference"})) class Payment {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @ManyToOne(optional=false) Loan loan;
 @ManyToOne(optional=false) AppUser registeredBy;
 LocalDate paidAt; BigDecimal amount; String method; String reference;
 @Column(columnDefinition="text") String receiptImageData;
 Payment(){}
}
@Entity @Table(name="payment_allocations") class PaymentAllocation {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @ManyToOne(optional=false) Payment payment;
 @ManyToOne(optional=false) Installment installment;
 BigDecimal principalAmount, interestAmount, insuranceAmount;
 PaymentAllocation(){}
}

/** RUC20: persona jurídica prestataria, distinta del DNI usado para medir el riesgo. */
@Entity @Table(name="companies") class Company {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(nullable=false,unique=true,length=11) String ruc;
 @Column(name="legal_name",nullable=false,length=255) String legalName;
 @Column(name="tax_status",length=50) String taxStatus;
 Company(){}
}
/** Vinculación comprobada por un asesor. Solo una identidad responsable por RUC en este flujo. */
@Entity @Table(name="document_links") class DocumentLink {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(name="document_type",nullable=false,length=5) String documentType;
 @Column(name="document_number",nullable=false,unique=true,length=11) String documentNumber;
 @ManyToOne(optional=false) Client client;
 @ManyToOne Company company;
 @Column(name="representative_name",length=180) String representativeName;
 @Column(name="representative_role",length=120) String representativeRole;
 @Column(name="documents_reviewed",nullable=false) boolean documentsReviewed;
 @Column(name="checked_at",nullable=false) java.time.Instant checkedAt;
 @ManyToOne(optional=false) @JoinColumn(name="checked_by_id") AppUser checkedBy;
 DocumentLink(){}
}
