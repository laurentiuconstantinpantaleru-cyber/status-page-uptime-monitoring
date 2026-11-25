               # INTERVIEW.md

## Formular online cu proprietari de aplicații (colegi)

- Metodă: Google Forms, 10 întrebări despre alerte, status page și mentenanță
- Data:25.11.2026
- Respondenți (4): Alex Manolea, Darius Mitaichie, Alessia Mihaila, Alexandra Oaida
- Rezultate complete: docs/survey-results.md
- Eșantion mic: un răspuns înseamnă un respondent, deci scriu "x din 4".

### Răspunsurile lor (totaluri pe cei 4 respondenți)
- După câte eșecuri consecutive vor alertă: imediat 1, după 2: 2, după 3: 1
- Canale de alertă: email 2, Telegram 1, fără alerte (verifică pe status page) 1
- Escaladare dacă nu confirmă: după 1 oră 2, după 15 min 1, o singură alertă e suficientă 1
- Alertă expirare TLS: 30 zile 2, 14 zile 1, 7 zile 1
- Pe status page vor: uptime % 4, istoric incidente cu cauză 4, grafic latență 3, banner mentenanță 3
- Închiderea incidentului: după 2-3 succese consecutive 3, la primul succes 1
- Detalii în alertă: cod HTTP și eroare 4, timp de la ultima verificare reușită 2, primele 200 de caractere din răspuns 1, buton de confirmare 1
- Încredere la incident: statusuri scrise de om pe etape 3, doar indicatori automați 1
- Afișare uptime: bare zilnice plus procent 2, doar bare 1, doar procent plus listă de incidente 1
- Pauza alertelor la deploy: buton rapid 15/30/60 min 2, calendar recurent 2

## Site-uri reale de firme mici din Sibiu (ținte de monitorizare)


| Firmă | URL | Observații (verificat 25.11.2026) |
|---|---|---|
| Hug The Mug (cafenea de specialitate, Calea Dumbrăvii 24 / N. Bălcescu 20) | https://hugthemug.ro/ | Live. `shop.hugthemug.ro` răspunde cu 302 către domeniul principal, deci se monitorizează direct `hugthemug.ro`. |
| Cafe Wien Sibiu (cafenea vieneză, Piața Huet 4) | http://cafewien.ro/ | Live, conținut actualizat (© 2026). Rulează pe HTTP, util pentru a testa cazul fără TLS / alerta de certificat. |


raspunsuri de la firme 
| După câte eșecuri consecutive vrea alertă | după 2 | după 3 |
| Canal de alertă | email | Telegram |
| Escaladare dacă nu confirmă | după 1 oră | o singură alertă e suficientă |
| Alertă expirare TLS | 30 zile | 30 zile |
| Ce vrea pe status page | uptime %, istoric incidente cu cauză, banner mentenanță | uptime %, banner mentenanță |
| Închiderea incidentului | după 2-3 succese consecutive | după 2-3 succese consecutive |
| Detalii în alertă | cod HTTP și eroare, timp de la ultima verificare reușită | cod HTTP și eroare, buton de confirmare |
| Încredere la incident | statusuri scrise de om pe etape | statusuri scrise de om pe etape |
| Afișare uptime | bare zilnice plus procent | doar procent plus listă de incidente |
| Pauza alertelor la deploy | calendar recurent | buton rapid 15/30/60 min |
