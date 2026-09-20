# Design Tokens

## Warna utama

| Token | Nilai | Fungsi |
|---|---:|---|
| Blue | `#195BFF` | CTA, active nav, admin |
| Cyan | `#24C9F3` | gradient / highlight |
| Purple | `#6B55FF` | kids / playful accent |
| Pink | `#FF4F8D` | warning / parent action |
| Green | `#2ACB8D` | success / active status |
| Amber | `#FFBD2D` | coin / reward / premium |
| Ink | `#10254E` | heading/text |

## Radius

- Phone: 36px
- Hero card: 28px
- Panel: 24px
- Stat card: 20px
- Small chip: 999px

## Breakpoint

- Desktop showcase: `> 900px`
- Mobile app mode: `<= 900px`

## Typography

Menggunakan system UI stack agar tidak membutuhkan font eksternal:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
```

Browser akan memakai font fallback yang tersedia di device.
