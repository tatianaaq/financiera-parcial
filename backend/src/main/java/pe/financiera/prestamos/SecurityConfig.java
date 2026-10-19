package pe.financiera.prestamos;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import java.util.Arrays;
import java.util.List;

@Configuration @EnableMethodSecurity
class SecurityConfig {
 @Bean PasswordEncoder passwordEncoder(){return new BCryptPasswordEncoder();}
 @Bean UserDetailsService userDetailsService(UserRepository users){return username->users.findByUsername(username).map(u->User.withUsername(u.username).password(u.password).roles(u.role).disabled(!u.enabled).build()).orElseThrow(()->new UsernameNotFoundException("Usuario no encontrado"));}
 @Bean CorsConfigurationSource corsConfigurationSource(@Value("${app.cors.allowed-origins:}") String allowedOrigins){
  CorsConfiguration configuration=new CorsConfiguration();
  configuration.setAllowedOrigins(Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(origin->!origin.isEmpty()).toList());
  configuration.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE","OPTIONS"));
  configuration.setAllowedHeaders(List.of("Authorization","Content-Type","Accept","Origin"));
  configuration.setAllowCredentials(false);
  UrlBasedCorsConfigurationSource source=new UrlBasedCorsConfigurationSource();
  source.registerCorsConfiguration("/api/**",configuration);
  return source;
 }
 @Bean SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
  return http.cors(Customizer.withDefaults()).csrf(c->c.disable()).headers(h->h.frameOptions(f->f.sameOrigin()))
   .authorizeHttpRequests(a->a.requestMatchers("/","/index.html","/favicon.ico","/h2-console/**").permitAll().requestMatchers(HttpMethod.OPTIONS,"/api/**").permitAll().requestMatchers("/api/admin/**").hasRole("ADMIN").requestMatchers("/api/**").authenticated().anyRequest().permitAll())
   .httpBasic(Customizer.withDefaults()).build();
 }
 @Bean @Order(1) @ConditionalOnProperty(name="app.seed.enabled",havingValue="true") CommandLineRunner seed(AgencyRepository agencies,UserRepository users,PasswordEncoder encoder,
   @Value("${app.admin.username}") String admin,@Value("${app.admin.password}") String adminPassword,
   @Value("${app.seed-password}") String seedPassword){return args->{
  if(adminPassword.isBlank()||seedPassword.isBlank())throw new IllegalStateException("APP_SEED_ENABLED=true requiere FINANCIERA_V2_ADMIN_PASSWORD y FINANCIERA_V2_SEED_PASSWORD configuradas.");
  String[] names={"Chimbote","Trujillo","Chiclayo","Piura","Tumbes"};
  for(String name:names){Agency a=agencies.findByName(name).orElseGet(()->agencies.save(new Agency(name))); String username="asesor."+name.toLowerCase();
   if(users.findByUsername(username).isEmpty())users.save(new AppUser(username,encoder.encode(seedPassword),"ADVISOR",a));}
  if(users.findByUsername(admin).isEmpty())users.save(new AppUser(admin,encoder.encode(adminPassword),"ADMIN",null));
 };}
}
