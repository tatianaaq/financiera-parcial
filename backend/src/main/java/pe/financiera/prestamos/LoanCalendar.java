package pe.financiera.prestamos;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Objects;

/**
 * Política única del cronograma: la fecha de origen es el día 1.
 * La cuota n vence el día natural (30 * n), contando el origen inclusivamente.
 * No representa meses del calendario.
 */
final class LoanCalendar {
    static final ZoneId LIMA = ZoneId.of("America/Lima");

    private LoanCalendar() {}

    static LocalDate todayInLima() {
        return todayInLima(Clock.systemUTC());
    }

    static LocalDate todayInLima(Clock clock) {
        return LocalDate.now(Objects.requireNonNull(clock, "clock").withZone(LIMA));
    }

    static LocalDate dueDate(LocalDate originationDate, int installmentNumber) {
        Objects.requireNonNull(originationDate, "originationDate");
        if (installmentNumber < 1) {
            throw new IllegalArgumentException("El número de cuota debe ser mayor que cero.");
        }
        return originationDate.plusDays(30L * installmentNumber - 1L);
    }
}
