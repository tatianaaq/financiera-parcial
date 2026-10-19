package pe.financiera.prestamos;

import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.*;
import java.util.stream.Collectors;

record UbigeoEntry(String ubigeo, String department, String province, String district) {}

/** Catálogo oficial local del INEI, compartido por los formularios y la validación del servidor. */
@Service
class UbigeoCatalog {
    private final List<UbigeoEntry> entries;
    private final Map<String, UbigeoEntry> byCode;

    UbigeoCatalog() {
        try (var stream = getClass().getResourceAsStream("/ubigeo-peru-inei.csv")) {
            if (stream == null) throw new IllegalStateException("No se encontró el catálogo local UBIGEO del INEI.");
            try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream, StandardCharsets.UTF_8))) {
                List<UbigeoEntry> loaded = reader.lines().skip(1).map(line -> line.replace("\uFEFF", "").split(";", -1))
                        .filter(columns -> columns.length >= 4)
                        .map(columns -> new UbigeoEntry(columns[0].trim(), title(columns[1]), title(columns[2]), title(columns[3])))
                        .filter(row -> row.ubigeo().matches("\\d{6}"))
                        .toList();
                if (loaded.size() < 1800) throw new IllegalStateException("El catálogo UBIGEO del INEI está incompleto.");
                entries = List.copyOf(loaded);
                byCode = entries.stream().collect(Collectors.toUnmodifiableMap(UbigeoEntry::ubigeo, row -> row));
                validateHierarchy();
            }
        } catch (java.io.IOException error) {
            throw new IllegalStateException("No se pudo leer el catálogo UBIGEO del INEI.", error);
        }
    }

    List<UbigeoEntry> entries() { return entries; }
    Optional<UbigeoEntry> find(String code) { return Optional.ofNullable(byCode.get(code)); }
    boolean same(String first, String second) { return normalize(first).equals(normalize(second)); }

    private void validateHierarchy() {
        if (entries.stream().anyMatch(row -> !row.department().isBlank() && !row.province().isBlank() && !row.district().isBlank()) == false) {
            throw new IllegalStateException("El catálogo UBIGEO no contiene ubicaciones utilizables.");
        }
        if (entries.stream().map(UbigeoEntry::ubigeo).distinct().count() != entries.size()) {
            throw new IllegalStateException("El catálogo UBIGEO contiene códigos repetidos.");
        }
    }

    private static String normalize(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                .replaceAll("[^\\p{L}\\p{N}]+", " ").trim().toUpperCase(Locale.ROOT);
    }

    private static String title(String value) {
        String lower = value.trim().toLowerCase(new Locale("es", "PE"));
        StringBuilder out = new StringBuilder(); boolean capitalize = true;
        for (char ch : lower.toCharArray()) { out.append(capitalize ? Character.toTitleCase(ch) : ch); capitalize = Character.isWhitespace(ch) || ch == '-'; }
        return out.toString();
    }
}
