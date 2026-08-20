# Credits

## Game content

### System Reference Document 5.2 — CC BY 4.0

Spells, equipment, magic items, species and feats imported from the **SRD 5.2**
via the [Open5e API](https://api.open5e.com/v2/) (document key `srd-2024`).

> This work includes material from the System Reference Document 5.2 ("SRD 5.2")
> by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The
> SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International
> License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

The full notice lives at **`srd-data/LICENSE.txt`**, beside the data rather than
only here, and `scripts/srd-import.mjs` refuses to write the dataset if it is
missing — the licence is a condition of using the content, not documentation
about it.

**Only `srd-2024` is imported.** Open5e aggregates two dozen documents, and
three of its endpoints silently ignore the document filter: passing the wrong
parameter returns Kobold Press, Tome of Beasts and other publishers' content
with no error. The importer therefore re-checks every row client-side and
reports what it rejected. None of that third-party material is included, and
none of it would be covered by the notice above.

Imported rows carry `source: 'srd'` and their Open5e slug in `srd_key`, so a row
stays traceable to this notice after it is loaded, exported, or copied onto a
character sheet.

## Icons

### game-icons.net — CC BY 3.0

The fantasy icon set (`public/icons/`, 4180 glyphs) comes from
[game-icons.net](https://game-icons.net). Licensed **CC BY 3.0**, except where a
contributor released their work as **CC0** (marked below).

The licence asks for a mention of *"Icons made by {author}"*. Each icon lives in
its contributor's folder — `public/icons/<author>/<name>.svg` — so the author of
any icon in the app is recoverable from the value stored on the row
(`gi:lorc/aura` → Lorc). The app surfaces this in the icon picker, which names
the contributor of the selected glyph.

**Do not flatten the per-author folders.** They are the only record of who made
which icon, and attribution is a licence condition.

| Contributor | |
|---|---|
| Lorc | [lorcblog.blogspot.com](http://lorcblog.blogspot.com) |
| Delapouite | [delapouite.com](https://delapouite.com) |
| John Colburn | [ninmunanmu.com](http://ninmunanmu.com) |
| Felbrigg | [blackdogofdoom.blogspot.co.uk](http://blackdogofdoom.blogspot.co.uk) |
| John Redman | [www.uniquedicetowers.com](http://www.uniquedicetowers.com) |
| Carl Olsen | [twitter.com/unstoppableCarl](https://twitter.com/unstoppableCarl) |
| Sbed | [opengameart.org/content/95-game-icons](http://opengameart.org/content/95-game-icons) |
| PriorBlue |  |
| Willdabeast | [wjbstories.blogspot.com](http://wjbstories.blogspot.com) |
| Viscious Speed (CC0) | [viscious-speed.deviantart.com](http://viscious-speed.deviantart.com) |
| Lord Berandas | [berandas.deviantart.com](http://berandas.deviantart.com) |
| Irongamer | [ecesisllc.wix.com/home](http://ecesisllc.wix.com/home) |
| HeavenlyDog | [www.gnomosygoblins.blogspot.com](http://www.gnomosygoblins.blogspot.com) |
| Lucas |  |
| Faithtoken | [fungustoken.deviantart.com](http://fungustoken.deviantart.com) |
| Skoll |  |
| Andy Meneely | [www.se.rit.edu/~andy](http://www.se.rit.edu/~andy/) |
| Cathelineau |  |
| Kier Heyl |  |
| Aussiesim |  |
| Sparker | [citizenparker.com](http://citizenparker.com) |
| Zeromancer (CC0) |  |
| Rihlsul |  |
| Quoting |  |
| Guard13007 | [guard13007.com](https://guard13007.com) |
| DarkZaitzev | [darkzaitzev.deviantart.com](http://darkzaitzev.deviantart.com) |
| SpencerDub |  |
| GeneralAce135 |  |
| Zajkonur |  |
| Catsu |  |
| Starseeker |  |
| Pepijn Poolman |  |
| Pierre Leducq |  |
| Caro Asercion |  |

### Font Awesome 6 Free

Interface glyphs are [Font Awesome 6 Free](https://fontawesome.com) — icons
under **CC BY 4.0**, fonts under **SIL OFL 1.1**.

## Fonts

Cinzel, EB Garamond and JetBrains Mono, all served from Google Fonts under the
**SIL Open Font License 1.1**.
