P26 · Status page + uptime monitoring
Categoria F · Dev tools & operare · Dificultate ★★★ · Efort estimat ~32h · Runda 1 · 1 student
Pe scurt: serviciu de monitorizare a disponibilității pentru proiectele reale ale colegilor și pentru site-urile unor firme locale: verificări HTTP / cuvânt-cheie / certificat TLS / timp de răspuns, incidente, alerte, ferestre de mentenanță, pagini publice de status și rapoarte de uptime.
🧑 Input uman obligatoriu
Minim 10 URL-uri live reale ale proiectelor colegilor (ceri acordul) + site-urile a 2 firme locale reale cu care vorbești ("ați vrea să știți când vă pică site-ul?"). Interviu cu 3 "proprietari" de aplicații (colegi) despre ce vor să vadă și cum vor să fie alertați. Monitorizezi minim 14 zile înainte de livrare. INTERVIEW.md + MONITORS.md.

Context real
Proiectul unui coleg a fost jos 6 ore înainte de susținere și nimeni nu a știut. Firma de lângă facultate are certificatul expirat de o săptămână. Un status page cu "99.97% uptime" și incidente explicate inspiră încredere; unul fals, dimpotrivă.
Cerințe funcționale (must)
Monitoare: HTTP(S) cu cod așteptat, cuvânt-cheie în răspuns, expirare certificat TLS (alertă cu N zile înainte), timp de răspuns cu prag; interval configurabil (1–60 min).
Incidente deschise și închise automat (down → up), cu durata, cauza (timeout, 500, keyword lipsă), confirmare din a două locație / worker înainte de a declara incident.
Alerte pe email și Telegram, cu escaladare (dacă nu e confirmat în 15 min, al doilea contact) și fără spam (o alertă per incident + una la rezolvare).
Ferestre de mentenanță programate (o dată / recurente) în care nu se alertează și downtime-ul nu contează.
Pagină publică de status per organizație: componente, stare curentă, incidente cu actualizări scrise de om, uptime pe 30 / 90 de zile, istoric de timp de răspuns.
Rapoarte: uptime lunar per monitor (PDF / email), top cauze, cel mai lent endpoint.
API (cheie) pentru a crea monitoare și a citi starea; badge SVG pentru README.
Roluri: vizitator (status page), membru, admin de organizație, admin global.
Cerințe tehnice specifice
Scheduler propriu care rulează sute de monitoare fără drift (un monitor la 1 min rulează de 60 de ori pe oră, nu 55) și fără suprapuneri (o verificare lentă nu pornește alta); test cu timp simulat.
Worker-îi de verificare sunt separați de web; minim 2 worker-i (pot fi pe același host) pentru confirmare.
Date brute păstrate 7 zile, apoi roll-up orar / zilnic (job); graficele pe 90 de zile citesc agregatele.
Pagina publică e cache-uită (sub 100 ms) și invalidată la schimbare de stare.
🌀 Twist: uptime-ul corect și alertele care nu plâng degeaba
Uptime-ul pe 30 de zile = timpul disponibil / (timpul total − ferestrele de mentenanță), calculat din incidente (nu din număr de verificări), cu incidente care traversează granița lunii și ferestre de mentenanță care se suprapun parțial cu incidente. Un incident se declară doar după N eșecuri consecutive confirmate de al doilea worker, se închide după M succese, iar o verificare care eșuează din cauza worker-ului (DNS-ul lui a picat) nu trebuie să producă incident — detectezi asta comparând cu celelalte monitoare din același worker. Totul testat cu timp simulat, nu cu sleep.

Variabilele tale
Cele 10 + 2 URL-uri reale.
N și M (praguri de deschidere / închidere) și politica de escaladare.
Retenția datelor brute și granularitatea roll-up-ului.
✅ Definition of Done
Minim 12 monitoare reale rulează pe live de minim 14 zile; status page-ul public e accesibil.
Un incident real (sau provocat) a fost detectat, alertat pe Telegram și închis automat.
Calculul de uptime cu mentenanță și incidente peste granița lunii are minim 5 teste.
Scheduler-ul nu driftează și nu suprapune (test cu timp simulat).
Cei 3 colegi intervievați au cerut ceva ce ai implementat (DECISIONS.md).

La susținere te întrebăm
Cum calculezi uptime-ul pe noiembrie pentru un monitor cu un incident 31 oct 23:00 → 1 nov 02:00 și mentenanță 1 nov 00:00 → 01:00?
Cum știi că a picat worker-ul și nu site-ul?
Cum rulează 300 de monitoare la 1 minut fără să se calce pe picioare?
