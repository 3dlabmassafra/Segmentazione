# Sezione — Studio di taglio 3D · v1.3

Applicazione web in italiano per dividere STL con percorsi disegnati direttamente sul modello. Interfaccia e implementazione originali: non è affiliata a STL Buddy o Nativos e non riproduce tutte le loro funzioni.

**Sito:** https://3dlabmassafra.github.io/Segmentazione/

## Novità: disegno a mano libera nella vista 3D

La modalità iniziale **Disegna** acquisisce il percorso del mouse, non una curva Bézier predefinita a quattro punti:

1. Importa un STL oppure usa il modello demo.
2. Ruota il modello nella direzione desiderata. Puoi anche scegliere Vista 3D, Frontale, Laterale o Dall’alto.
3. Seleziona **Curvo** (mano libera) oppure **Retto** (segmento).
4. Premi **Posiziona un taglio**.
5. Tieni premuto il pulsante sinistro del mouse e traccia un tratto direttamente sulla superficie del modello, poi rilascia. Anche il trascinamento touch è gestito con Pointer Events.
6. **Gira intorno all'oggetto** (trascina con il tasto destro o con due dita) e continua lo stesso taglio sulle facce successive: i tratti si collegano da soli, in qualsiasi direzione tu abbia disegnato.
7. Quando il percorso chiude l'anello attorno al modello, il banner mostra **Anello chiuso attorno al modello** e l'anteprima si aggiorna da sola in due parti con superfici di taglio chiuse.
8. Premi **Chiudi il taglio** per uscire dalla modalità di disegno, poi esporta gli STL singolarmente o in ZIP. Puoi anche tracciare più anelli indipendenti (fino a 8 tagli, 32 parti).

Il tratto è campionato sulla superficie reale del modello (stesso motore di raycast del calcolo geometrico): ciò che disegni è esattamente ciò che viene tagliato, in qualsiasi vista. Le estremità di ogni tratto vengono prolungate automaticamente oltre il volume, così il taglio attraversa sempre tutto il materiale. Un tratto che non divide il modello viene rifiutato con un messaggio chiaro, senza toccare le parti già calcolate.

### Gestione dei tagli

- Fino a **8 tagli** nello stesso progetto, anche da viste diverse.
- Massimo **32 parti risultanti**, incluse le componenti scollegate.
- Selezione di un taglio nell’elenco, ripristino della sua vista, ridisegno e regolazione della levigatura.
- Attivazione/disattivazione ed eliminazione dei singoli tagli.
- **Annulla** o `Ctrl/Cmd + Z` ripristina l’ultima modifica all’elenco (25 livelli).
- **Esc** o il pulsante Annulla cancella il tratto in corso. Non interrompe un calcolo geometrico già avviato.
- Wireframe, raggi X, griglia, vista esplosa e selezione delle parti.
- Anteprima esplicita: gli export sono disattivati quando i tagli sono stati modificati ma non ancora applicati.

### Altre modalità conservate

- **Piani:** fino a 5 piani paralleli lungo X, Y o Z, posizionabili con slider o campi numerici.
- **Bézier:** una curva cubica parametrica a quattro punti, con profili Onda, Arco e Valle e tre viste di disegno. È uno strumento separato dal nuovo disegno libero.

Le modalità sono alternative: nella stessa operazione non vengono combinati tagli di modalità diverse.

## Limiti espliciti

- Importazione **STL ASCII o binario**, massimo **120 MB e 2.000.000 di triangoli**. Servono mesh chiuse, correttamente orientate; il programma non ripara buchi o auto-intersezioni arbitrarie.
- Le coordinate STL sono interpretate come millimetri; il formato non specifica unità.
- I percorsi a mano libera sono **aperti**, senza incroci con sé stessi o con i propri prolungamenti. Gli anelli chiusi vengono rifiutati con un messaggio. Tagli distinti, invece, possono intersecarsi.
- I tratti sono discretizzati e possono essere leggermente levigati: non sono curve matematicamente esatte né superfici a doppia curvatura indipendenti dalla proiezione.
- I tagli attivi attraversano tutte le parti che incontrano, non soltanto la parte selezionata.
- **Non sono inclusi perni, incastri o tolleranze di accoppiamento automatiche.**
- Un solido chiuso non è automaticamente stampabile senza supporti: verifica scala, spessori, orientamento, volume di stampa e supporti nello slicer.
- I modelli densi possono richiedere molta RAM e tempo. È consigliato un browser desktop a 64 bit. I limiti indicati non garantiscono prestazioni uguali su ogni dispositivo o su qualsiasi mesh.
- Non ci sono salvataggio automatico, importazione OBJ/3MF o ripristino di un progetto da file. Scarica gli export prima di chiudere o ricaricare la pagina.

## Esportazione

Ogni parte STL viene centrata in X/Y e appoggiata a Z = 0, senza rotazione automatica. La vista esplosa è solo una separazione visiva e non altera le coordinate esportate.

Lo ZIP contiene gli STL numerati, `LEGGIMI.txt` e `profilo-taglio.json`. Quest’ultimo documenta vista, percorso e parametri dei tagli applicati, ma non è ancora reimportabile come progetto.

## Elaborazione locale e memoria

I file STL non vengono inviati a server. Rendering, geometria e download sono eseguiti nel browser; non servono account, backend, database o chiavi API. Le librerie, i font e il motore WASM sono serviti insieme al sito.

La lettura binaria evita di duplicare i vettori normali dello STL. Prima di costruire il solido WASM, il worker indicizza i vertici esattamente coincidenti della triangle soup per ridurre l’uso di memoria: non è una decimazione della superficie. Per visualizzare mesh dense vengono calcolate normali smussate senza modificare vertici o triangoli.

## Avvio locale

Richiede Node.js **20.19+ oppure 22.12+** e npm.

```bash
npm ci
npm run dev
```

Apri l’URL mostrato nel terminale. Per la build di produzione alla radice di un hosting:

```bash
npm run build
npm run preview
```

Il risultato è in `dist/`. Sono necessari HTTP/HTTPS, WebGL, Web Worker e WebAssembly: non aprire l’HTML con doppio clic usando `file://`.

## GitHub Pages

Repository: https://github.com/3dlabmassafra/Segmentazione

Il workflow `.github/workflows/deploy-pages.yml` pubblica a ogni push su `main`. In **Settings → Pages → Source** deve essere selezionato **GitHub Actions**.

Il workflow imposta `VITE_BASE_PATH=/Segmentazione/`. Per testare lo stesso percorso localmente:

```bash
VITE_BASE_PATH=/Segmentazione/ npm run build
VITE_BASE_PATH=/Segmentazione/ npm run preview
```

Se cambi nome al repository, aggiorna il percorso nel workflow. Non inserire password o token nei file versionati.

## Tecnologie

Three.js · Manifold 3D / WebAssembly · Web Worker · fflate · Lucide · DM Sans / Manrope · Vite.

## Test

Con il dev server avviato sulla porta 5173:

```bash
npx playwright install --with-deps chromium
node tests/freehand.mjs
node tests/functional.mjs
node tests/curved.mjs
```

Il test mano libera verifica acquisizione reale del mouse, più tagli da viste diverse, corrispondenza prospettica, conservazione del volume, solidi chiusi negli STL esportati, metadati, annullamento, attivazione/disattivazione e layout mobile. Gli altri test coprono piani e Bézier.

Test opzionale più oneroso, con un rilievo sintetico di **1.085.760 triangoli in ingresso**:

```bash
node tests/dense-mesh.mjs
```

Genera un STL temporaneo di circa 54 MB, verifica importazione e taglio a mano libera, poi lo elimina. Questo test non equivale a una verifica sullo specifico modello del cliente. I test automatici non garantiscono la validità di qualsiasi mesh importata.
