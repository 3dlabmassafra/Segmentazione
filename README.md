# Sezione — Studio di taglio 3D

Applicazione web in italiano per dividere modelli STL con tagli rettilinei o curvi. Versione 1.1. Interfaccia originale, ispirata alla categoria di strumenti di taglio multi-parte; non è una copia completa di Nativos Studio e non è affiliata al servizio.

## Avvio

Richiede Node.js 20.19+ o 22.12+ e npm.

```bash
npm ci
npm run dev
```

Apri l'indirizzo mostrato nel terminale. Per una build di produzione:

```bash
npm run build
npm run preview
```

Il risultato di `npm run build` è nella cartella `dist/`: pubblicala alla radice di un hosting statico. Nell'archivio consegnato trovi anche `sito-pronto/`, una build già compilata da caricare su un hosting statico. Servono HTTP/HTTPS e supporto ai Web Worker e WebAssembly: non aprire `index.html` con doppio clic usando `file://`.

Non sono necessari backend, database, account o chiavi API. Font, motore WASM e librerie sono serviti insieme al sito. L'applicazione non invia i file STL a server esterni. Non usa localStorage e non salva automaticamente il progetto: scarica le parti prima di chiudere o ricaricare la scheda.

## Funzioni implementate

- Importazione STL binario e ASCII con trascinamento o selezione file.
- Controllo di validità del solido con Manifold WASM e saldatura dei vertici coincidenti tramite `Mesh.merge()`.
- Limiti: 30 MB e 500.000 triangoli per file. La memoria disponibile dipende dal dispositivo.
- Modello dimostrativo parametrico di un vaso a coste, generato localmente.
- Taglio curvo Bézier con quattro punti di controllo modificabili direttamente sul modello, trascinamento, frecce della tastiera o coordinate numeriche.
- Profili iniziali Onda, Arco e Valle, con viste frontale, laterale e dall’alto.
- La curva viene estesa attraverso tutta la profondità del modello: il taglio genera due solidi con superfici curve corrispondenti.
- In modalità rettilinea: fino a 5 piani paralleli sull’asse X, Y o Z (fino a 6 sezioni).
- Posizione dei piani tramite slider o campo numerico, relativa al limite inferiore del modello sull'asse selezionato.
- Tagli geometrici reali con chiusura delle superfici, calcolati in un Web Worker per non bloccare l'interfaccia.
- Rotazione, zoom, selezione delle parti, wireframe, griglia, vista dall'alto e vista esplosa.
- Anteprime delle singole parti, dimensioni e conteggio triangoli.
- Download STL binario individuale o archivio ZIP con tutti gli STL e istruzioni.
- Layout adattabile per desktop, tablet e smartphone; guida integrata.

## Flusso d'uso

1. Il sito apre un vaso dimostrativo già diviso in due parti con un taglio curvo.
2. Importa il tuo STL: la mesh viene centrata in X/Y e appoggiata a Z = 0. Viene applicato il taglio della modalità selezionata (curvo per impostazione iniziale, oppure due piani uniformi lungo Z in modalità rettilinea).
3. Per un taglio curvo scegli la vista, poi **Modifica curva sul modello**: trascina P0–P3 oppure usa le coordinate. P0/P3 sono gli estremi, P1/P2 modellano la curvatura. Gli estremi restano fuori dai bordi. In modalità rettilinea puoi scegliere l’asse e aggiungere/rimuovere i piani.
4. Premi **Applica taglio curvo** o **Taglia** nell’editor (oppure **Applica tagli** in modalità rettilinea). Gli export sono disattivati finché i piani modificati non sono stati applicati.
5. Usa **Esporta tutte le parti** o l'icona di download su una singola parte.

Scorciatoie: `R` centra il modello, `W` attiva/disattiva il wireframe, `Invio` applica i tagli modificati quando il focus non è su un campo o un pulsante, `Ctrl/Cmd + O` apre un STL.

## Limiti e note per la stampa

- Questa versione non genera incastri, spine, tolleranze o connettori automatici.
- La modalità curva applica una sola Bézier cubica per operazione, non un tratto a mano libera né una rete di curve. La curva procede da sinistra a destra senza tornare indietro; i controlli orizzontali sono vincolati per evitare auto-intersezioni.
- Il profilo 2D viene estruso lungo X, Y o Z: non è una superficie a doppia curvatura. La mesh triangolata usa 256 segmenti per approssimare la Bézier. Non sono disponibili tagli sequenziali su parti selezionate: per un ulteriore taglio puoi esportare una parte e reimportarla.
- Non supporta piani obliqui, assi misti nello stesso passaggio o importazione OBJ/3MF. Il file `profilo-taglio.json` incluso nello ZIP documenta i parametri, ma non può ancora essere reimportato come progetto.
- I file STL non contengono unità: tutte le coordinate sono interpretate come millimetri.
- Sono richieste mesh chiuse e correttamente orientate. La saldatura dei vertici non ripara automaticamente buchi, auto-intersezioni o geometrie arbitrarie. Verifica sempre anche nel tuo slicer.
- Una sezione può contenere più componenti scollegate. Un piano in un vuoto non produce una parte vuota esportabile: il numero di parti può essere inferiore a quello teorico.
- Le parti esportate sono centrate separatamente in X/Y e appoggiate a Z = 0, senza rotazione automatica. La vista esplosa è solo visiva.
- «Solido chiuso» non significa che la parte si possa stampare senza supporti o ulteriori verifiche. Controlla volume di stampa, spessori, scala, orientamento e supporti nel tuo slicer.
- Il modello demo ha una parete di circa 3 mm. La stampabilità delle nervature dipende dalle impostazioni della stampante.

## Tecnologie

- Three.js per visualizzazione 3D, import ed export STL.
- Manifold 3D / WebAssembly per solidi e tagli topologici.
- Web Worker per l'elaborazione geometrica.
- fflate per esportazione ZIP.
- Lucide per le icone, DM Sans e Manrope per i font locali.
- Vite per sviluppo e build.

## Verifiche

```bash
npx playwright install --with-deps chromium
# Con il dev server avviato sulla porta 5173:
node tests/functional.mjs
node tests/curved.mjs
```

Il test controlla l'esportazione del demo, l'importazione di un cubo, tagli su tutti e tre gli assi, validità manifold degli STL riesportati, conservazione del volume, aggiunta/rimozione piani, rifiuto di un file non valido senza perdere il modello precedente, download ZIP, comandi di visualizzazione e assenza di overflow orizzontale su mobile.

I test dei tagli curvi verificano tutte le 9 combinazioni di profilo e vista, la non planarità del bordo risultante, la conservazione del volume, le mesh esportate, il trascinamento dei punti, i campi numerici, l’editor responsive e il ritorno ai tagli rettilinei.

I test automatici non sostituiscono una validazione completa su qualsiasi mesh. I file dei test generati e gli screenshot non sono necessari per pubblicare il sito.

## Pubblicazione su GitHub Pages

Repository: https://github.com/3dlabmassafra/Segmentazione

URL previsto dopo il deploy: https://3dlabmassafra.github.io/Segmentazione/

Il workflow `.github/workflows/deploy-pages.yml` compila e pubblica automaticamente a ogni push sul branch `main`. Nel repository, **Settings → Pages → Build and deployment → Source** deve essere impostato su **GitHub Actions**.

Il workflow imposta `VITE_BASE_PATH=/Segmentazione/`, necessario per caricare correttamente script, font, worker e WASM sotto il percorso del repository. Per testare localmente la stessa configurazione:

```bash
VITE_BASE_PATH=/Segmentazione/ npm run build
VITE_BASE_PATH=/Segmentazione/ npm run preview
```

Se cambi nome al repository, aggiorna `VITE_BASE_PATH` nel workflow. Non inserire mai password o token nel codice o nei file versionati.
