# Party Groups

Aplikacja internetowa do losowego dzielenia uczestników imprezy na możliwie równe, kolorowe grupy.

## Funkcje

- tworzenie pokoju przez administratora,
- dołączanie uczestników przez kod,
- lista uczestników odświeżana automatycznie,
- usuwanie osób przed zamknięciem zapisów,
- zamykanie i ponowne otwieranie zapisów,
- proponowanie najwygodniejszych podziałów,
- losowanie uczestników,
- przypisanie koloru każdej grupie,
- ponowne losowanie grup,
- brak konieczności zakładania kont.

## Uruchomienie

Wymagany jest Node.js w wersji 18 lub nowszej.

```bash
npm install
npm start
```

Następnie otwórz:

```text
http://localhost:3000
```

## Tryb deweloperski

```bash
npm run dev
```

## Baza danych

Przy pierwszym uruchomieniu automatycznie powstaje plik:

```text
party-groups.db
```

Aplikacja korzysta z SQLite, więc nie trzeba instalować osobnego serwera bazy danych.

## Udostępnienie w sieci lokalnej

Uruchom aplikację na komputerze, sprawdź jego lokalny adres IP i otwórz na telefonach:

```text
http://ADRES_IP_KOMPUTERA:3000
```

Zapora systemowa może poprosić o zgodę na dostęp do sieci.

## Struktura

```text
party-groups-app/
├── package.json
├── server.js
├── README.md
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```
