# Whatcom Maritime Storytelling Atlas — Prototype v9

This iteration focuses on Mapped Memories:
- robust map-click selection that queries the full AGOL feature before filling the detail panel
- image/description field resolution that tolerates field-name/alias differences
- automatic chip/button filters when a category has fewer than five values
- no desktop Filters button (icon-only drawer trigger remains on mobile)
- expanded Mystery Photo viewer with next mystery / view on map / help identify
- expanded Then + Now explorer with next comparison / view on map
- custom Mapped Memories camera-marker renderer applied in the custom app only; AGOL data and Web Map remain unchanged

Upload the contents of this folder to the Atlas development subdomain document root and hard-refresh / use a cache-busting query string such as `mapped.html?v=9`.
