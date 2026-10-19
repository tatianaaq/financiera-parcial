package pe.financiera.prestamos;

import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Component;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.*;

/** Separates legacy shared client rows by the branch of their existing loans. */
@Component
@Order(2)
@ConditionalOnProperty(name = "app.migrations.client-agency.enabled", havingValue = "true")
class ClientAgencyMigration implements CommandLineRunner {
    private final JdbcTemplate jdbc;

    ClientAgencyMigration(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Override public void run(String... args) {
        removeLegacyGlobalDniConstraint();
        List<Long> unassigned = jdbc.queryForList(
                "select id from clients where agency_id is null order by id", Long.class);
        for (Long clientId : unassigned) splitByLoanAgency(clientId);
    }

    private void removeLegacyGlobalDniConstraint() {
        Map<String, Set<String>> uniqueColumns = new LinkedHashMap<>();
        jdbc.query("select tc.constraint_name, ccu.column_name " +
                        "from information_schema.table_constraints tc " +
                        "join information_schema.constraint_column_usage ccu " +
                        "on tc.constraint_catalog=ccu.constraint_catalog " +
                        "and tc.constraint_schema=ccu.constraint_schema " +
                        "and tc.constraint_name=ccu.constraint_name " +
                        "where lower(tc.table_name)='clients' and tc.constraint_type='UNIQUE'",
                (org.springframework.jdbc.core.RowCallbackHandler) rs -> uniqueColumns.computeIfAbsent(rs.getString(1), ignored -> new HashSet<>())
                        .add(rs.getString(2).toLowerCase(Locale.ROOT)));

        for (var constraint : uniqueColumns.entrySet()) {
            if (constraint.getValue().equals(Set.of("dni"))) {
                String safeName = constraint.getKey().replace("\"", "\"\"");
                jdbc.execute("alter table clients drop constraint \"" + safeName + "\"");
            }
        }
    }

    private void splitByLoanAgency(Long clientId) {
        List<Long> agencyIds = jdbc.queryForList(
                "select distinct agency_id from loans where client_id=? order by agency_id",
                Long.class, clientId);
        if (agencyIds.isEmpty()) return;

        Long ownerAgencyId = agencyIds.getFirst();
        jdbc.update("update clients set agency_id=? where id=?", ownerAgencyId, clientId);
        for (Long agencyId : agencyIds.subList(1, agencyIds.size())) {
            KeyHolder generated = new GeneratedKeyHolder();
            jdbc.update(connection -> {
                PreparedStatement statement = connection.prepareStatement(
                        "insert into clients (agency_id,dni,names,surnames,phone,address,registered_at,active) " +
                                "select ?,dni,names,surnames,phone,address,registered_at,active from clients where id=?",
                        Statement.RETURN_GENERATED_KEYS);
                statement.setLong(1, agencyId);
                statement.setLong(2, clientId);
                return statement;
            }, generated);
            Number newClientId = generated.getKey();
            if (newClientId == null) throw new IllegalStateException("No se pudo separar el cliente " + clientId);
            jdbc.update("update loans set client_id=? where client_id=? and agency_id=?",
                    newClientId.longValue(), clientId, agencyId);
        }
    }
}
