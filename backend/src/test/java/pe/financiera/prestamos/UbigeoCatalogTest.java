package pe.financiera.prestamos;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class UbigeoCatalogTest {
    @Test
    void loadsNationwideIneiDistrictCatalogAndIncludesRequiredLocations() {
        UbigeoCatalog catalog = new UbigeoCatalog();
        assertEquals(1892, catalog.entries().size());
        assertEquals(25, catalog.entries().stream().map(UbigeoEntry::department).distinct().count());
        assertTrue(catalog.entries().stream().anyMatch(row -> row.ubigeo().equals("070101")
                && row.department().equals("Callao") && row.province().equals("Callao") && row.district().equals("Callao")));
        assertTrue(catalog.entries().stream().anyMatch(row -> row.ubigeo().equals("130111")
                && row.province().equals("Trujillo") && row.district().equals("Victor Larco Herrera")));
        assertTrue(catalog.entries().stream().anyMatch(row -> row.ubigeo().equals("140101")
                && row.department().equals("Lambayeque") && row.province().equals("Chiclayo") && row.district().equals("Chiclayo")));
        assertTrue(catalog.same("Víctor Larco Herrera", "Victor Larco Herrera"));
    }
}
