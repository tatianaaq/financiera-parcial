package pe.financiera.prestamos;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.math.BigDecimal;
import java.util.*;

/** La caja es por sucursal: solo una sesión OPEN por agencia. Los movimientos son inmutables. */
@RestController
@RequestMapping("/api/cash")
class CashController {
 private final JdbcTemplate jdbc;
 private final UserRepository users;
 CashController(JdbcTemplate jdbc, UserRepository users){this.jdbc=jdbc;this.users=users;}

 record OpenInput(BigDecimal amount){}
 record MovementInput(String type, BigDecimal amount, String description, String requestKey){}
 record CloseInput(BigDecimal countedAmount, String note){}

 private AppUser user(Authentication auth){
  AppUser u=users.findByUsername(auth.getName()).orElseThrow(()->new AccessDeniedException("Usuario no encontrado"));
  if(!u.enabled||!"ADVISOR".equals(u.role)||u.agency==null||!u.agency.enabled)throw new AccessDeniedException("Caja: se requiere un asesor de una sucursal habilitada.");
  return u;
 }
 private Long lockAgency(AppUser u){
  // Serializa cambios de la caja de una misma agencia, sin bloquear otras sucursales.
  return jdbc.queryForObject("SELECT id FROM agencies WHERE id=? AND enabled=true FOR UPDATE", Long.class,u.agency.id);
 }
 private Long openSession(Long agencyId){
  List<Long> ids=jdbc.queryForList("SELECT id FROM cash_sessions WHERE agency_id=? AND status='OPEN'", Long.class,agencyId);
  if(ids.isEmpty())throw new IllegalArgumentException("No existe una caja abierta en esta sucursal.");
  return ids.get(0);
 }
 private BigDecimal positive(BigDecimal value, boolean zeroAllowed){
  if(value==null||value.scale()>2||value.signum() < (zeroAllowed?0:1) ||value.compareTo(new BigDecimal("999999999.99"))>0)
   throw new IllegalArgumentException("El monto debe ser válido, positivo y tener como máximo dos decimales.");
  return value.setScale(2);
 }
 private BigDecimal balance(Long sessionId){
  BigDecimal bal=jdbc.queryForObject("""
    SELECT opening_amount + coalesce((SELECT sum(CASE
      WHEN movement_type IN ('INCOME','REPLENISHMENT') THEN amount
      WHEN movement_type='EXPENSE' THEN -amount ELSE 0 END)
      FROM cash_movements WHERE session_id=s.id),0)
    FROM cash_sessions s WHERE s.id=?
    """, BigDecimal.class, sessionId);
  return Objects.requireNonNull(bal);
 }
 private Map<String,Object> state(Long agencyId){
  Map<String,Object> out=new LinkedHashMap<>();out.put("agencyId",agencyId);
  List<Map<String,Object>> sessions=jdbc.queryForList("SELECT id, opened_at AS \"openedAt\", opening_amount AS \"openingAmount\", status FROM cash_sessions WHERE agency_id=? AND status='OPEN'",agencyId);
  if(sessions.isEmpty()){out.put("open",false);out.put("balance",BigDecimal.ZERO);out.put("movements",List.of());return out;}
  Map<String,Object> sess=sessions.get(0);Long id=((Number)sess.get("id")).longValue();
  out.put("open",true);out.put("sessionId",id);out.put("openedAt",sess.get("openedAt"));out.put("openingAmount",sess.get("openingAmount"));out.put("balance",balance(id));
  out.put("movements",jdbc.queryForList("SELECT id, movement_type AS \"type\", amount, description, created_at AS \"createdAt\" FROM cash_movements WHERE session_id=? ORDER BY id DESC",id));
  return out;
 }
 @GetMapping @Transactional(readOnly=true) Map<String,Object> get(Authentication auth){return state(user(auth).agency.id);}
 @GetMapping("/history") @Transactional(readOnly=true) List<Map<String,Object>> history(Authentication auth){
  AppUser u=user(auth);
  return jdbc.queryForList("SELECT id, opened_at AS \"openedAt\", opening_amount AS \"openingAmount\", closed_at AS \"closedAt\", expected_amount AS \"expectedAmount\", counted_amount AS \"countedAmount\", difference_amount AS \"differenceAmount\", status FROM cash_sessions WHERE agency_id=? ORDER BY id DESC LIMIT 30",u.agency.id);
 }
 @PostMapping("/open") @Transactional Map<String,Object> open(@RequestBody OpenInput req,Authentication auth){
  AppUser u=user(auth);BigDecimal amount=positive(req.amount(),true);lockAgency(u);
  if(!jdbc.queryForList("SELECT id FROM cash_sessions WHERE agency_id=? AND status='OPEN'",Long.class,u.agency.id).isEmpty())throw new IllegalArgumentException("Esta sucursal ya tiene una caja abierta.");
  jdbc.update("INSERT INTO cash_sessions(agency_id, opened_by_id, opening_amount) VALUES (?,?,?)",u.agency.id,u.id,amount);
  return state(u.agency.id);
 }
 @PostMapping("/movement") @Transactional Map<String,Object> movement(@RequestBody MovementInput req,Authentication auth){
  AppUser u=user(auth);lockAgency(u);Long id=openSession(u.agency.id);
  String type=req.type()==null?"":req.type().trim().toUpperCase(Locale.ROOT);
  if(!Set.of("INCOME","EXPENSE","REPLENISHMENT","INCIDENT").contains(type))throw new IllegalArgumentException("Tipo de movimiento inválido.");
  BigDecimal amount=positive(req.amount(),"INCIDENT".equals(type));
  if("INCIDENT".equals(type)&&amount.signum()!=0)throw new IllegalArgumentException("Una incidencia no modifica el saldo. Registra el ajuste como un movimiento separado.");
  String description=req.description()==null?"":req.description().trim();
  if(description.isEmpty()||description.length()>500)throw new IllegalArgumentException("Ingresa una descripción de máximo 500 caracteres.");
  if(req.requestKey()==null||!req.requestKey().matches("[A-Za-z0-9_-]{12,64}"))throw new IllegalArgumentException("Falta identificador de operación válido.");
  List<Long> duplicates=jdbc.queryForList("SELECT id FROM cash_movements WHERE request_key=?",Long.class,req.requestKey());
  if(!duplicates.isEmpty())return state(u.agency.id); // solicitud repetida: no duplica movimientos
  if("EXPENSE".equals(type)&&balance(id).compareTo(amount)<0)throw new IllegalArgumentException("Saldo de caja insuficiente para esta salida.");
  jdbc.update("INSERT INTO cash_movements(session_id, recorded_by_id, movement_type,amount,description,request_key) VALUES (?,?,?,?,?,?)",id,u.id,type,amount,description,req.requestKey());
  return state(u.agency.id);
 }
 @PostMapping("/close") @Transactional Map<String,Object> close(@RequestBody CloseInput req,Authentication auth){
  AppUser u=user(auth);BigDecimal counted=positive(req.countedAmount(),true);lockAgency(u);Long id=openSession(u.agency.id);
  BigDecimal expected=balance(id);String note=req.note()==null?"":req.note().trim();if(note.length()>500)throw new IllegalArgumentException("Nota de cierre demasiado larga.");
  jdbc.update("UPDATE cash_sessions SET status='CLOSED',closed_by_id=?,closed_at=now(),expected_amount=?,counted_amount=?,difference_amount=?,closing_note=? WHERE id=? AND status='OPEN'",u.id,expected,counted,counted.subtract(expected),note,id);
  return state(u.agency.id);
 }
 @ExceptionHandler(IllegalArgumentException.class) ResponseEntity<Map<String,String>> badInput(IllegalArgumentException ex){return ResponseEntity.badRequest().body(Map.of("error",ex.getMessage()));}
}
