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
 BigDecimal principal; BigDecimal outstandingPrincipal; BigDecimal annualRate=new BigDecimal("0.30");
 int installments; boolean insurance; LocalDate disbursedAt;
 @Column(nullable=false) String status="ACTIVO";
 Loan(){}
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
