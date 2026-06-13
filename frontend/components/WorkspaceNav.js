// frontend/components/WorkspaceNav.js

export function getArticleCount() {
  // Stub — populated by doc 12d
  return 0;
}

export const NAV_ITEMS = [
  {
    section: 'Profile',
    items: [
      { id: 'strength',   icon: '◆', label: 'Core Strength',    color: 'gold'   },
      { id: 'directions', icon: '⟡', label: 'Directions',        color: 'blue'   },
      { id: 'portrait',   icon: '◈', label: 'Career Portrait',   color: 'green'  },
    ]
  },
  {
    section: 'Goal',
    items: [
      { id: 'goal', icon: '⟶', label: 'Career Goal', color: 'blue' },
    ]
  },
  {
    section: 'Publish',
    items: [
      { id: 'headline',  icon: '—', label: 'LinkedIn Headline', color: 'default' },
      { id: 'summary',   icon: '—', label: 'LinkedIn Summary',  color: 'default' },
      { id: 'bio',       icon: '—', label: 'Short Bio',         color: 'default' },
      { id: 'articles',  icon: '—', label: 'Articles',          color: 'default',
        badge: () => getArticleCount() },
    ]
  },
  {
    section: null, // no section header — bottom nav
    items: [
      { id: 'graph',    icon: '↗', label: 'Graph',    color: 'default', external: true },
      { id: 'settings', icon: '⚙', label: 'Settings', color: 'default' },
    ]
  }
];

export function renderNav(activeId) {
  return NAV_ITEMS.map(section => `
    ${section.section
      ? `<div class="nav-section-label">${section.section}</div>`
      : '<div class="nav-sep"></div>'}
    ${section.items.map(item => `
      <div class="nav-item ${activeId === item.id ? 'active' : ''}"
           data-id="${item.id}"
           onclick="navigateTo('${item.id}')">
        <span class="nav-icon" style="color:var(--${item.color === 'default' ? 't3' : item.color})">
          ${item.icon}
        </span>
        <span class="nav-label">${item.label}</span>
        ${item.badge ? `<span class="nav-badge">${item.badge()}</span>` : ''}
        ${item.external ? `<span class="nav-external">↗</span>` : ''}
      </div>
    `).join('')}
  `).join('');
}
