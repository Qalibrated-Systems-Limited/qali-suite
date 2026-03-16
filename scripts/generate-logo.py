#!/usr/bin/env python3
"""
Generate QaliSuite logo variants as SVGs.
Produces:
  - qalisuite-icon.svg (icon only, works on any bg)
  - qalisuite-icon-light.svg (icon for light backgrounds)
  - qalisuite-icon-dark.svg (icon for dark backgrounds)
  - qalisuite-logo-light.svg (icon + text for light bg)
  - qalisuite-logo-dark.svg (icon + text for dark bg)
"""
import os

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "brand")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Colors
GOLD = "#EAB308"        # Yellow-500 (matches Tailwind)
GOLD_DARK = "#CA8A04"   # Yellow-600
DARK_TEXT = "#18181B"    # zinc-900
LIGHT_TEXT = "#FAFAFA"   # zinc-50
MUTED_DARK = "#71717A"  # zinc-500
MUTED_LIGHT = "#A1A1AA"  # zinc-400

def icon_svg(size=48):
    """
    Modern geometric Q mark:
    - A rounded square with a stylized Q cut from negative space
    - The Q tail extends out diagonally as a dynamic stroke
    """
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
  <defs>
    <linearGradient id="qg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FACC15"/>
      <stop offset="100%" stop-color="{GOLD_DARK}"/>
    </linearGradient>
  </defs>
  <!-- Rounded square background -->
  <rect x="2" y="2" width="44" height="44" rx="12" ry="12" fill="url(#qg)"/>
  <!-- Q circle (negative space) -->
  <circle cx="24" cy="22" r="11" fill="none" stroke="{DARK_TEXT}" stroke-width="4.5" stroke-linecap="round"/>
  <!-- Q tail - dynamic diagonal -->
  <line x1="30" y1="28" x2="39" y2="37" stroke="{DARK_TEXT}" stroke-width="4.5" stroke-linecap="round"/>
  <!-- Inner accent dot -->
  <circle cx="24" cy="22" r="2.5" fill="{DARK_TEXT}"/>
</svg>'''


def icon_v2_svg(size=48):
    """
    Version 2: Shield-inspired Q with layered depth.
    More refined, enterprise-feel.
    """
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">
  <defs>
    <linearGradient id="qg2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047"/>
      <stop offset="50%" stop-color="#EAB308"/>
      <stop offset="100%" stop-color="#A16207"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.15"/>
    </filter>
  </defs>
  <!-- Main shape: squircle -->
  <rect x="3" y="3" width="42" height="42" rx="14" ry="14" fill="url(#qg2)" filter="url(#shadow)"/>
  <!-- Q letter - bold geometric -->
  <circle cx="24" cy="21" r="10" fill="none" stroke="white" stroke-width="4" opacity="0.95"/>
  <!-- Q tail -->
  <line x1="30" y1="27" x2="37" y2="34" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.95"/>
</svg>'''


def logo_svg(text_color, subtitle_color, variant_name=""):
    """Full logo: icon + QaliSuite text"""
    icon_w = 44
    text_start = 54
    total_w = 200
    total_h = 48

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w} {total_h}" width="{total_w}" height="{total_h}">
  <defs>
    <linearGradient id="qg_logo{variant_name}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047"/>
      <stop offset="50%" stop-color="#EAB308"/>
      <stop offset="100%" stop-color="#A16207"/>
    </linearGradient>
    <filter id="shadow_logo{variant_name}">
      <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.15"/>
    </filter>
  </defs>

  <!-- Icon -->
  <rect x="2" y="2" width="{icon_w}" height="{icon_w}" rx="14" ry="14" fill="url(#qg_logo{variant_name})" filter="url(#shadow_logo{variant_name})"/>
  <circle cx="24" cy="22" r="10" fill="none" stroke="white" stroke-width="4" opacity="0.95"/>
  <line x1="30" y1="28" x2="37" y2="35" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.95"/>

  <!-- Text: QaliSuite -->
  <text x="{text_start}" y="28" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="22" font-weight="700" fill="{text_color}" letter-spacing="-0.5">
    <tspan>Qali</tspan><tspan fill="{GOLD}">Suite</tspan>
  </text>
  <!-- Subtitle -->
  <text x="{text_start}" y="42" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="9" font-weight="500" fill="{subtitle_color}" letter-spacing="2.5" text-transform="uppercase">
    ERP SYSTEM
  </text>
</svg>'''


def favicon_svg():
    """Tiny favicon version - just the Q mark, minimal"""
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="qfav" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE047"/>
      <stop offset="50%" stop-color="#EAB308"/>
      <stop offset="100%" stop-color="#A16207"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="30" height="30" rx="8" ry="8" fill="url(#qfav)"/>
  <circle cx="16" cy="14.5" r="7" fill="none" stroke="white" stroke-width="3" opacity="0.95"/>
  <line x1="20.5" y1="19" x2="25.5" y2="24" stroke="white" stroke-width="3" stroke-linecap="round" opacity="0.95"/>
</svg>'''


def write_svg(filename, content):
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, 'w') as f:
        f.write(content.strip())
    print(f"  Created: {path}")


if __name__ == "__main__":
    print("Generating QaliSuite brand assets...\n")

    # Icon variants
    write_svg("qalisuite-icon.svg", icon_v2_svg(48))
    write_svg("qalisuite-icon-lg.svg", icon_v2_svg(128))

    # Full logos
    write_svg("qalisuite-logo-light.svg", logo_svg(DARK_TEXT, MUTED_DARK, "_light"))
    write_svg("qalisuite-logo-dark.svg", logo_svg(LIGHT_TEXT, MUTED_LIGHT, "_dark"))

    # Favicon
    write_svg("qalisuite-favicon.svg", favicon_svg())

    # Also generate the alt icon style
    write_svg("qalisuite-icon-alt.svg", icon_svg(48))

    print(f"\nDone! All files saved to {OUTPUT_DIR}")
