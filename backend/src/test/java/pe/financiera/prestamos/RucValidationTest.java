package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RucValidationTest {
    @Test void validSunatChecksum() {
        assertTrue(RucLookupController.isValidRuc("20100113610"));
        assertTrue(RucLookupController.isValidRuc("20610438769"));
    }
    @Test void invalidRucRejectedWithoutSpendingQuota() {
        assertFalse(RucLookupController.isValidRuc("20100113611"));
        assertFalse(RucLookupController.isValidRuc("2010011361"));
        assertFalse(RucLookupController.isValidRuc("abc"));
    }
}
