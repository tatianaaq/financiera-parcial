package pe.financiera.prestamos;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@TestConfiguration
class JsonPeTestConfiguration {
    @Bean @Primary FakeJsonPeClient simulatedJsonPeClient(RestClient.Builder builder) {
        return new FakeJsonPeClient(builder);
    }
}

/** Test double: every test response stays local and never calls or spends credits at JSON.pe. */
class FakeJsonPeClient extends JsonPeClient {
    private final Map<String, Stub> stubs = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> calls = new ConcurrentHashMap<>();

    FakeJsonPeClient(RestClient.Builder builder) { super(builder, "https://api.json.pe/api/dni", ""); }

    void respond(String dni, JsonPeDniResponse response) { stubs.put(dni, ignored -> response); }
    void fail(String dni, DniLookupException error) { stubs.put(dni, ignored -> { throw error; }); }
    void respondAfter(String dni, JsonPeDniResponse response, Duration delay) {
        stubs.put(dni, ignored -> {
            try { Thread.sleep(delay.toMillis()); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
            return response;
        });
    }
    int callsFor(String dni) { return calls.getOrDefault(dni, new AtomicInteger()).get(); }

    @Override public JsonPeDniResponse lookup(String dni) {
        calls.computeIfAbsent(dni, ignored -> new AtomicInteger()).incrementAndGet();
        Stub stub = stubs.get(dni);
        if (stub == null) throw new AssertionError("Unexpected simulated JSON.pe request for " + dni);
        return stub.run(dni);
    }

    @FunctionalInterface private interface Stub { JsonPeDniResponse run(String dni); }
}
