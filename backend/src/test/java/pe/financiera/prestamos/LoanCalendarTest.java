package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.*;

class LoanCalendarTest {
    @Test
    void loanOfOctober21HasNovember19FirstInstallment() {
        LocalDate origin = LocalDate.of(2026, 10, 21);
        assertEquals(LocalDate.of(2026, 11, 19), LoanCalendar.dueDate(origin, 1));
        assertEquals(LocalDate.of(2026, 12, 19), LoanCalendar.dueDate(origin, 2));
        assertEquals(LocalDate.of(2027, 1, 18), LoanCalendar.dueDate(origin, 3));
    }

    @Test
    void theOriginationDateIsDayOneForEveryInstallment() {
        LocalDate origin = LocalDate.of(2026, 10, 21);
        for (int number = 1; number <= 36; number++) {
            assertEquals(30L * number,
                    ChronoUnit.DAYS.between(origin, LoanCalendar.dueDate(origin, number)) + 1L);
        }
    }

    @Test
    void inclusiveRuleWorksAcrossLeapDaysAndYearBoundaries() {
        assertEquals(LocalDate.of(2028, 3, 28),
                LoanCalendar.dueDate(LocalDate.of(2028, 2, 28), 1));
        assertEquals(LocalDate.of(2027, 1, 29),
                LoanCalendar.dueDate(LocalDate.of(2026, 12, 31), 1));
    }

    @Test
    void businessDateUsesLimaEvenWhenServerIsOnUtc() {
        Clock serverClock = Clock.fixed(Instant.parse("2026-10-22T01:30:00Z"), ZoneOffset.UTC);
        assertEquals(LocalDate.of(2026, 10, 21), LoanCalendar.todayInLima(serverClock));
    }

    @Test
    void rejectsInvalidInstallmentNumbers() {
        LocalDate origin = LocalDate.of(2026, 10, 21);
        assertThrows(IllegalArgumentException.class, () -> LoanCalendar.dueDate(origin, 0));
        assertThrows(IllegalArgumentException.class, () -> LoanCalendar.dueDate(origin, -1));
        assertThrows(NullPointerException.class, () -> LoanCalendar.dueDate(null, 1));
    }
}
