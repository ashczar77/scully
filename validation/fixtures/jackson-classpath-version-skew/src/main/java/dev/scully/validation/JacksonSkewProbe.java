package dev.scully.validation;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

public final class JacksonSkewProbe {
    private JacksonSkewProbe() {
    }

    public static void main(String[] args) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String json = mapper.writeValueAsString(Map.of("status", "ready"));
        System.out.println(json);
    }
}
