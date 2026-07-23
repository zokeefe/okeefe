/**
 * O'Keefe Family Tree Visualization Engine
 * Pure Vanilla JavaScript implementation with zero dependencies.
 * Features hierarchical graph layout, infinite canvas navigation, prefix auto-complete search,
 * precision ancestry path highlighting, Google Maps style 4-state pull-up card, and unified canvas drag physics.
 */

// Visual Configuration and Zoom Thresholds
const CONFIG = {
    NODE_WIDTH: 220,
    NODE_HEIGHT: 104,
    GEN_HEIGHT: 210,         // Vertical distance between generations
    NODE_GAP_X: 50,          // Minimum horizontal gap between separate families/nodes
    COUPLE_GAP_X: 24,        // Horizontal gap between partners/spouses
    ZOOM_LOW: 0.20,          // Scale threshold below which only names are shown
    ZOOM_MED: 0.35,          // Scale threshold below which dates are shown but secondary meta is hidden
    MAX_ZOOM: 3.5,
    MIN_ZOOM: 0.15,
    ANIM_DURATION: 600       // Milliseconds for smooth panning animations
};

// Application State
const state = {
    people: {},              // Map of id -> person object
    couples: [],             // Array of couple relationships inferred from shared children
    generations: {},         // Map of generation index -> array of person objects
    selectedId: null,        // Active selected node ID
    sheet: {
        current: 'hidden'    // Mobile card state: 'hidden', 'minimized', 'medium', 'expanded'
    },
    viewport: {
        x: 0,
        y: 0,
        scale: 1.0
    },
    drag: {
        active: false,
        startX: 0,
        startY: 0,
        panStartX: 0,
        panStartY: 0
    },
    pinch: {
        active: false,
        initialDistance: 0,
        initialScale: 1.0,
        midX: 0,
        midY: 0,
        panStartX: 0,
        panStartY: 0
    },
    search: {
        selectedIndex: -1,
        matches: []
    }
};

// DOM Elements Reference
const DOM = {};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initDOMReferences();
    setupEventListeners();
    setupTouchGestures();
    setupMobileBottomSheet();
    loadFamilyTreeData(`family_tree.json?v=${Date.now()}`);
});

function initDOMReferences() {
    DOM.canvasArea = document.getElementById('canvas-area');
    DOM.svg = document.getElementById('graph-svg');
    DOM.viewportGroup = document.getElementById('viewport-group');
    DOM.edgesLayer = document.getElementById('edges-layer');
    DOM.nodesLayer = document.getElementById('nodes-layer');
    DOM.searchInput = document.getElementById('search-input');
    DOM.autocompleteDropdown = document.getElementById('autocomplete-dropdown');
    DOM.metadataPanel = document.getElementById('metadata-panel');
    DOM.metadataContent = document.getElementById('metadata-content');
    DOM.sheetHandle = document.getElementById('sheet-handle');
    DOM.btnZoomIn = document.getElementById('btn-zoom-in');
    DOM.btnZoomOut = document.getElementById('btn-zoom-out');
    DOM.btnZoomFit = document.getElementById('btn-zoom-fit');
}

/**
 * Fetch and process the JSON source data
 */
async function loadFamilyTreeData(url) {
    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const rawData = await response.json();
        
        processData(rawData);
        computeHierarchicalLayout();
        renderGraph();
        fitToScreen();
        
        // Handle URL hash deep links on load and browser navigation
        handleInitialURLHash();
    } catch (err) {
        console.error('Failed to load family tree dataset:', err);
        if (DOM.metadataContent) {
            DOM.metadataContent.innerHTML = `
                <div class="meta-placeholder" style="color: #ef4444;">
                    <strong>Error loading dataset:</strong><br>
                    Could not fetch ${url}. Ensure you are serving index.html over an HTTP server.
                </div>
            `;
        }
    }
}

/**
 * URL Deep Linking & Browser History Navigation
 */
function handleInitialURLHash() {
    const initialId = window.location.hash.replace(/^#/, '').trim();
    if (initialId && state.people[initialId]) {
        selectPerson(initialId, false);
        setTimeout(() => focusNode(initialId), 150);
    }

    window.addEventListener('hashchange', () => {
        const id = window.location.hash.replace(/^#/, '').trim();
        if (id && state.people[id]) {
            if (state.selectedId !== id) {
                selectPerson(id, false);
                focusNode(id);
            }
        } else if (!id && state.selectedId) {
            clearSelection(false);
        }
    });
}

/**
 * Index individuals and infer marriage/partnership links via shared children
 */
function processData(rawData) {
    state.people = {};
    state.couples = [];
    const coupleMap = new Map();

    rawData.forEach(item => {
        state.people[item.id] = {
            ...item,
            children: [],
            parents: [],
            partners: [],
            gen: -1,
            x: 0,
            y: 0
        };
    });

    Object.values(state.people).forEach(p => {
        const hasMother = p.mother && state.people[p.mother];
        const hasFather = p.father && state.people[p.father];

        if (hasMother) {
            p.parents.push(p.mother);
            state.people[p.mother].children.push(p.id);
        }
        if (hasFather) {
            p.parents.push(p.father);
            state.people[p.father].children.push(p.id);
        }

        if (hasMother && hasFather) {
            const m = state.people[p.mother];
            const f = state.people[p.father];

            if (!m.partners.includes(f.id)) m.partners.push(f.id);
            if (!f.partners.includes(m.id)) f.partners.push(m.id);

            const coupleKey = [m.id, f.id].sort().join(',');
            if (!coupleMap.has(coupleKey)) {
                const coupleObj = {
                    id: coupleKey,
                    p1: m.id,
                    p2: f.id,
                    children: [],
                    gen: -1,
                    midX: 0,
                    y: 0
                };
                coupleMap.set(coupleKey, coupleObj);
                state.couples.push(coupleObj);
            }
            coupleMap.get(coupleKey).children.push(p.id);
        }
    });
}

/**
 * Custom hierarchical graph layout calculation
 */
function computeHierarchicalLayout() {
    const people = Object.values(state.people);
    const roots = people.filter(p => p.parents.length === 0);
    roots.forEach(r => { r.gen = 0; });

    let changed = true;
    let iterations = 0;
    while (changed && iterations < 50) {
        changed = false;
        iterations++;

        people.forEach(p => {
            if (p.parents.length > 0) {
                const maxParentGen = Math.max(...p.parents.map(parentId => state.people[parentId].gen));
                if (maxParentGen !== -1 && p.gen !== maxParentGen + 1) {
                    p.gen = maxParentGen + 1;
                    changed = true;
                }
            }

            p.partners.forEach(partnerId => {
                const partner = state.people[partnerId];
                if (partner.gen !== -1 && p.gen !== -1 && p.gen !== partner.gen) {
                    const highestGen = Math.max(p.gen, partner.gen);
                    if (p.gen < highestGen) { p.gen = highestGen; changed = true; }
                    if (partner.gen < highestGen) { partner.gen = highestGen; changed = true; }
                } else if (partner.gen === -1 && p.gen !== -1) {
                    partner.gen = p.gen;
                    changed = true;
                }
            });
        });
    }

    people.forEach(p => {
        if (p.gen === -1) p.gen = 0;
        p.y = p.gen * CONFIG.GEN_HEIGHT;
    });

    state.couples.forEach(c => {
        c.gen = Math.max(state.people[c.p1].gen, state.people[c.p2].gen);
        c.y = c.gen * CONFIG.GEN_HEIGHT;
    });

    state.generations = {};
    people.forEach(p => {
        if (!state.generations[p.gen]) state.generations[p.gen] = [];
        state.generations[p.gen].push(p);
    });

    const maxGen = Math.max(...Object.keys(state.generations).map(Number));
    for (let g = 0; g <= maxGen; g++) {
        const layer = state.generations[g] || [];
        const placed = new Set();
        const ordered = [];

        layer.forEach(p => {
            if (placed.has(p.id)) return;
            placed.add(p.id);
            ordered.push(p);

            p.partners.forEach(partnerId => {
                if (!placed.has(partnerId) && state.people[partnerId].gen === g) {
                    placed.add(partnerId);
                    ordered.push(state.people[partnerId]);
                }
            });
        });
        state.generations[g] = ordered;
    }

    for (let pass = 0; pass < 6; pass++) {
        for (let g = 1; g <= maxGen; g++) {
            const layer = state.generations[g] || [];
            layer.forEach(p => {
                if (p.parents.length > 0) {
                    const avgParentX = p.parents.reduce((sum, pid) => sum + state.people[pid].x, 0) / p.parents.length;
                    p.targetX = avgParentX;
                } else {
                    p.targetX = p.x || 0;
                }
            });
            spaceOutLayer(layer);
        }

        for (let g = maxGen - 1; g >= 0; g--) {
            const layer = state.generations[g] || [];
            layer.forEach(p => {
                if (p.children.length > 0) {
                    const avgChildX = p.children.reduce((sum, cid) => sum + state.people[cid].x, 0) / p.children.length;
                    p.targetX = avgChildX;
                } else {
                    p.targetX = p.x || 0;
                }
            });
            spaceOutLayer(layer);
        }
    }

    let globalMinX = Infinity, globalMaxX = -Infinity;
    for (let g = 0; g <= maxGen; g++) {
        spaceOutLayer(state.generations[g] || []);
        (state.generations[g] || []).forEach(p => {
            globalMinX = Math.min(globalMinX, p.x - CONFIG.NODE_WIDTH / 2);
            globalMaxX = Math.max(globalMaxX, p.x + CONFIG.NODE_WIDTH / 2);
        });
    }
    
    const treeCenter = (globalMinX + globalMaxX) / 2;
    people.forEach(p => { p.x -= treeCenter; });

    state.couples.forEach(c => {
        c.midX = (state.people[c.p1].x + state.people[c.p2].x) / 2;
    });
}

function spaceOutLayer(layer) {
    if (layer.length === 0) return;
    layer.sort((a, b) => (a.targetX !== undefined ? a.targetX - b.targetX : a.x - b.x));

    for (let i = 0; i < layer.length; i++) {
        const p = layer[i];
        if (i === 0) {
            p.x = p.targetX || 0;
        } else {
            const prev = layer[i - 1];
            const isPartner = p.partners.includes(prev.id);
            const requiredGap = isPartner ? CONFIG.COUPLE_GAP_X : CONFIG.NODE_GAP_X;
            const minX = prev.x + CONFIG.NODE_WIDTH + requiredGap;
            p.x = Math.max(p.targetX || 0, minX);
        }
    }

    const layerCenter = layer.reduce((sum, p) => sum + p.x, 0) / layer.length;
    layer.forEach(p => { p.x -= layerCenter; });
}

/**
 * Render edges and nodes into SVG
 * Edges are drawn strictly outside rectangle boundaries and broken into individual child paths
 */
function renderGraph() {
    DOM.edgesLayer.innerHTML = '';
    DOM.nodesLayer.innerHTML = '';

    state.couples.forEach(c => {
        const p1 = state.people[c.p1];
        const p2 = state.people[c.p2];

        // Route couple bar strictly between the outer edges of partner node rectangles
        const leftEdgeX = Math.min(p1.x, p2.x) + CONFIG.NODE_WIDTH / 2;
        const rightEdgeX = Math.max(p1.x, p2.x) - CONFIG.NODE_WIDTH / 2;

        const couplePath = createSVGElement('path', {
            d: `M ${leftEdgeX} ${c.y} L ${rightEdgeX} ${c.y}`,
            class: 'edge couple-edge',
            'data-parent1': p1.id,
            'data-parent2': p2.id,
            'data-type': 'couple'
        });
        DOM.edgesLayer.appendChild(couplePath);

        if (c.children.length > 0) {
            const busY = c.y + CONFIG.NODE_HEIGHT / 2 + (CONFIG.GEN_HEIGHT - CONFIG.NODE_HEIGHT) / 2;
            
            // Vertical parent drop from couple midpoint down to generation midway level
            const dropPath = createSVGElement('path', {
                d: `M ${c.midX} ${c.y} L ${c.midX} ${busY}`,
                class: 'edge parent-drop',
                'data-parent1': p1.id,
                'data-parent2': p2.id,
                'data-type': 'parent-drop'
            });
            DOM.edgesLayer.appendChild(dropPath);

            // Create individualized orthogonal path segments per child so we can highlight single parent->child traces
            c.children.forEach(cid => {
                const child = state.people[cid];
                const childPath = createSVGElement('path', {
                    d: `M ${c.midX} ${busY} L ${child.x} ${busY} L ${child.x} ${child.y - CONFIG.NODE_HEIGHT / 2}`,
                    class: 'edge child-path',
                    'data-parent1': p1.id,
                    'data-parent2': p2.id,
                    'data-child': cid,
                    'data-type': 'child-path'
                });
                DOM.edgesLayer.appendChild(childPath);
            });
        }
    });

    // Single parent connections (parents without documented partner in dataset)
    Object.values(state.people).forEach(p => {
        p.children.forEach(cid => {
            const child = state.people[cid];
            const otherParent = child.parents.find(id => id !== p.id);
            if (!otherParent) {
                const busY = p.y + CONFIG.NODE_HEIGHT / 2 + (CONFIG.GEN_HEIGHT - CONFIG.NODE_HEIGHT) / 2;
                const path = createSVGElement('path', {
                    d: `M ${p.x} ${p.y + CONFIG.NODE_HEIGHT / 2} L ${p.x} ${busY} L ${child.x} ${busY} L ${child.x} ${child.y - CONFIG.NODE_HEIGHT / 2}`,
                    class: 'edge single-parent-edge',
                    'data-parent1': p.id,
                    'data-child': cid,
                    'data-type': 'child-path'
                });
                DOM.edgesLayer.appendChild(path);
            }
        });
    });

    // Draw Node Rectangles
    Object.values(state.people).forEach(p => {
        const nodeGroup = createSVGElement('g', {
            id: `node-${p.id}`,
            class: `node ${p.gender || 'M'}`,
            transform: `translate(${p.x - CONFIG.NODE_WIDTH / 2}, ${p.y - CONFIG.NODE_HEIGHT / 2})`,
            'data-id': p.id
        });

        const box = createSVGElement('rect', {
            class: 'node-box',
            width: CONFIG.NODE_WIDTH,
            height: CONFIG.NODE_HEIGHT
        });
        nodeGroup.appendChild(box);

        const textName = createSVGElement('text', {
            class: 'node-text-name',
            x: CONFIG.NODE_WIDTH / 2,
            y: 32
        });
        const nodeDisplayName = p.nickname ? `${p.name} "${p.nickname}"` : p.name;
        textName.textContent = truncateText(nodeDisplayName, 22);
        nodeGroup.appendChild(textName);

        const textDates = createSVGElement('text', {
            class: 'node-text-dates',
            x: CONFIG.NODE_WIDTH / 2,
            y: 58
        });
        const by = p.meta?.birth_year || '?';
        const dy = p.meta?.death_year || '';
        const bdayStr = p.meta?.birthday ? formatBirthday(p.meta.birthday, true) : null;
        textDates.textContent = bdayStr ? (dy ? `${bdayStr} – ${dy}` : `b. ${bdayStr}`) : (dy ? `${by} – ${dy}` : `b. ${by}`);
        nodeGroup.appendChild(textDates);

        const textMeta = createSVGElement('text', {
            class: 'node-text-meta',
            x: CONFIG.NODE_WIDTH / 2,
            y: 82
        });
        const formatLoc = loc => loc ? [loc.town, loc.country].filter(Boolean).join(', ') : null;
        const resLoc = formatLoc(p.meta?.residence_location);
        const birthLoc = formatLoc(p.meta?.birth_location);
        const legacyLoc = [p.meta?.town_of_residence, p.meta?.country_of_residence].filter(Boolean).join(', ');
        const locationDisplay = resLoc || birthLoc || legacyLoc || '';
        const metaDetail = locationDisplay || p.meta?.occupation || '';
        textMeta.textContent = truncateText(metaDetail, 28);
        nodeGroup.appendChild(textMeta);

        // NOTE: Individual node click events are intentionally omitted here.
        // Unified interaction is managed centrally in pointerup/touchend on the canvas area
        // to permit click-and-drag map panning directly over node surfaces.

        DOM.nodesLayer.appendChild(nodeGroup);
    });
}

function createSVGElement(tag, attributes = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function truncateText(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
}

/**
 * Node Selection & Precision Ancestry Lineage Highlighting
 */
function selectPerson(id, updateURL = true) {
    if (state.selectedId === id && window.innerWidth > 768) return;
    
    state.selectedId = id;
    if (!id) {
        clearSelection(updateURL);
        return;
    }

    if (updateURL && window.location.hash !== `#${id}`) {
        try { history.pushState(null, '', `#${id}`); } catch (err) {}
    }

    const target = state.people[id];
    if (!target) return;

    const ancestors = new Set();
    function findAncestors(pid) {
        const p = state.people[pid];
        if (!p) return;
        p.parents.forEach(parentID => {
            if (!ancestors.has(parentID)) {
                ancestors.add(parentID);
                findAncestors(parentID);
            }
        });
    }
    findAncestors(id);

    const descendants = new Set();
    function findDescendants(pid) {
        const p = state.people[pid];
        if (!p) return;
        p.children.forEach(childID => {
            if (!descendants.has(childID)) {
                descendants.add(childID);
                findDescendants(childID);
            }
        });
    }
    findDescendants(id);

    const directLine = new Set([id, ...ancestors, ...descendants]);
    DOM.viewportGroup.classList.add('has-selection');

    Object.values(state.people).forEach(p => {
        const el = document.getElementById(`node-${p.id}`);
        if (!el) return;
        
        el.classList.remove('selected', 'dimmed', 'in-ancestry');
        if (p.id === id) {
            el.classList.add('selected', 'in-ancestry');
        } else if (directLine.has(p.id)) {
            el.classList.add('in-ancestry');
        } else {
            el.classList.add('dimmed');
        }
    });

    // Precision Edge Highlighting: Only highlight single paths directly traversing the lineage
    const edges = DOM.edgesLayer.querySelectorAll('.edge');
    edges.forEach(edge => {
        const p1 = edge.getAttribute('data-parent1');
        const p2 = edge.getAttribute('data-parent2');
        const child = edge.getAttribute('data-child');
        const type = edge.getAttribute('data-type');

        edge.classList.remove('ancestor-edge', 'descendant-edge', 'dimmed');

        // Determine if an individual child path is in the ancestor or descendant lineage
        const isChildAnc = child && (child === id || ancestors.has(child)) && ((p1 && ancestors.has(p1)) || (p2 && ancestors.has(p2)) || (child === id && ((p1 && ancestors.has(p1)) || (p2 && ancestors.has(p2)))));
        const isChildDesc = child && (descendants.has(child)) && ((p1 && (p1 === id || descendants.has(p1))) || (p2 && (p2 === id || descendants.has(p2))));

        if (type === 'child-path') {
            if (isChildAnc || (child === id && (ancestors.has(p1) || ancestors.has(p2)))) {
                edge.classList.add('ancestor-edge');
            } else if (isChildDesc) {
                edge.classList.add('descendant-edge');
            } else {
                edge.classList.add('dimmed');
            }
            return;
        }

        // For parent drops and couple partnership bars, highlight if any associated child in the lineage connects through here
        const coupleAnc = (p1 && (p1 === id || ancestors.has(p1))) && (p2 && (p2 === id || ancestors.has(p2)));
        const parentDropAnc = ancestors.has(p1) || ancestors.has(p2);
        const parentDropDesc = (p1 === id || descendants.has(p1)) || (p2 === id || descendants.has(p2));

        // Search if any active child in direct ancestry shares this parent combination
        let hasAncChild = false, hasDescChild = false;
        if (p1 || p2) {
            const childrenList = state.people[p1]?.children || state.people[p2]?.children || [];
            hasAncChild = childrenList.some(cid => cid === id || ancestors.has(cid));
            hasDescChild = childrenList.some(cid => descendants.has(cid));
        }

        if (type === 'parent-drop') {
            if (hasAncChild && parentDropAnc) {
                edge.classList.add('ancestor-edge');
            } else if (hasDescChild && parentDropDesc) {
                edge.classList.add('descendant-edge');
            } else {
                edge.classList.add('dimmed');
            }
            return;
        }

        if (type === 'couple') {
            if ((hasAncChild && parentDropAnc) || coupleAnc) {
                edge.classList.add('ancestor-edge');
            } else if (hasDescChild && parentDropDesc) {
                edge.classList.add('descendant-edge');
            } else {
                edge.classList.add('dimmed');
            }
            return;
        }

        edge.classList.add('dimmed');
    });

    renderMetadata(target);
    if (window.innerWidth <= 768) {
        setSheetState('medium');
    }
}

function clearSelection(updateURL = true) {
    state.selectedId = null;
    DOM.viewportGroup.classList.remove('has-selection');

    if (updateURL && window.location.hash) {
        try { history.pushState(null, '', window.location.pathname + window.location.search); } catch (err) {}
    }
    
    document.querySelectorAll('.node').forEach(n => {
        n.classList.remove('selected', 'dimmed', 'in-ancestry');
    });
    document.querySelectorAll('.edge').forEach(e => {
        e.classList.remove('ancestor-edge', 'descendant-edge', 'dimmed');
    });

    if (DOM.metadataContent) {
        DOM.metadataContent.innerHTML = `
            <p class="meta-header">Dynamic Metadata</p>
            <div class="meta-placeholder">
                Select any person from the family tree graph or use the search bar above to inspect details and illuminate direct lineage.
            </div>
        `;
    }
    
    if (window.innerWidth <= 768) {
        setSheetState('hidden');
    }
}

/**
 * Format standardized ISO 8601 (YYYY-MM-DD) birthday strings for presentation
 */
function formatBirthday(isoString, short = false) {
    if (!isoString || typeof isoString !== 'string') return null;
    const parts = isoString.split('-');
    if (parts.length === 3) {
        const [year, month, day] = parts.map(Number);
        const fullMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const months = short ? shortMonths : fullMonths;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${months[month - 1]} ${day}, ${year}`;
        }
    }
    return isoString;
}

/**
 * Render Dynamic Metadata Card
 */
function renderMetadata(p) {
    if (!DOM.metadataContent) return;
    const by = p.meta?.birth_year || 'Unknown';
    const dy = p.meta?.death_year || 'Present';
    const bday = p.meta?.birthday ? formatBirthday(p.meta.birthday) : null;

    const parentLinks = p.parents.length > 0 
        ? p.parents.map(pid => `<span class="meta-link" data-id="${pid}">${state.people[pid]?.name || pid}</span>`).join(', ')
        : 'None recorded';

    const childrenLinks = p.children.length > 0
        ? p.children.map(cid => `<span class="meta-link" data-id="${cid}">${state.people[cid]?.name || cid}</span>`).join(', ')
        : 'None recorded';

    const partnerLinks = p.partners.length > 0
        ? p.partners.map(pid => `<span class="meta-link" data-id="${pid}">${state.people[pid]?.name || pid}</span>`).join(', ')
        : 'None recorded';

    DOM.metadataContent.innerHTML = `
        <p class="meta-header">Person Details</p>
        <div class="meta-card">
            <div class="meta-title-bar">
                <h2 class="meta-name">${p.name}${p.nickname ? ` "${p.nickname}"` : ''}</h2>
                <span class="meta-badge ${p.gender || 'M'}">${p.gender === 'F' ? 'Female' : 'Male'}</span>
            </div>
            <div class="meta-rows">
                <div class="meta-row">
                    <span class="meta-label">Lifespan</span>
                    <span class="meta-value">${by} – ${dy}</span>
                </div>
                ${bday ? `
                <div class="meta-row">
                    <span class="meta-label">Birthday</span>
                    <span class="meta-value">${bday}</span>
                </div>` : ''}
                ${p.meta?.occupation ? `
                <div class="meta-row">
                    <span class="meta-label">Occupation</span>
                    <span class="meta-value">${p.meta.occupation}</span>
                </div>` : ''}
                ${p.meta?.birth_location?.town || p.meta?.birth_location?.country ? `
                <div class="meta-row">
                    <span class="meta-label">Birthplace</span>
                    <span class="meta-value">${[p.meta.birth_location.town, p.meta.birth_location.country].filter(Boolean).join(', ')}</span>
                </div>` : ''}
                ${p.meta?.residence_location?.town || p.meta?.residence_location?.country || p.meta?.town_of_residence || p.meta?.country_of_residence ? `
                <div class="meta-row">
                    <span class="meta-label">Residence</span>
                    <span class="meta-value">${[p.meta?.residence_location?.town || p.meta?.town_of_residence, p.meta?.residence_location?.country || p.meta?.country_of_residence].filter(Boolean).join(', ')}</span>
                </div>` : ''}
                <div class="meta-row">
                    <span class="meta-label">Parents</span>
                    <span class="meta-value">${parentLinks}</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Spouse / Partners</span>
                    <span class="meta-value">${partnerLinks}</span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Children</span>
                    <span class="meta-value">${childrenLinks}</span>
                </div>
                ${p.meta?.about ? `
                <div class="meta-row">
                    <span class="meta-label">About & History</span>
                    <span class="meta-value">${p.meta.about}</span>
                </div>` : ''}
            </div>
        </div>
    `;

    DOM.metadataContent.querySelectorAll('.meta-link').forEach(link => {
        link.addEventListener('click', () => {
            const targetId = link.getAttribute('data-id');
            if (targetId && state.people[targetId]) {
                selectPerson(targetId);
                focusNode(targetId);
                if (window.innerWidth <= 768 && state.sheet.current === 'minimized') {
                    setSheetState('medium');
                }
            }
        });
    });
}

/**
 * Google Maps Style 4-State Mobile Bottom Sheet Controller
 */
function getSnapOffsets() {
    const H = window.innerHeight;
    const panel = DOM.metadataPanel;
    const cardH = panel ? (panel.offsetHeight || H * 0.92) : (H * 0.92);
    
    const minimizedVisH = Math.max(96, H * 0.11); // ~11% screen height (grab handle + title bar)
    const mediumVisH = H * 0.50;                 // 50% screen height
    const expandedVisH = cardH;                  // 92% screen height (0px translate)

    return {
        expanded: 0,
        medium: Math.max(0, cardH - mediumVisH),
        minimized: Math.max(0, cardH - minimizedVisH),
        hidden: cardH + 40
    };
}

function setSheetState(newState) {
    if (window.innerWidth > 768) return;
    const panel = DOM.metadataPanel;
    if (!panel) return;

    state.sheet.current = newState;
    panel.style.transition = ''; // Restore CSS spring transition

    const offsets = getSnapOffsets();
    const targetOffset = offsets[newState] ?? offsets.hidden;
    panel.style.transform = `translateY(${targetOffset}px)`;

    if (newState === 'expanded') {
        panel.style.overflowY = 'auto';
    } else {
        panel.style.overflowY = 'hidden';
        if (panel.scrollTop !== 0) panel.scrollTop = 0;
    }

    document.body.classList.remove('sheet-hidden', 'sheet-minimized', 'sheet-medium', 'sheet-expanded');
    document.body.classList.add(`sheet-${newState}`);
}

function setupMobileBottomSheet() {
    const panel = DOM.metadataPanel;
    if (!panel) return;

    let startY = 0, startX = 0, currentY = 0;
    let startTranslateY = 0, startScrollTop = 0;
    let isDraggingSheet = false, touchStartedOnCard = false;

    panel.addEventListener('click', (e) => {
        if (window.innerWidth > 768) return;
        if (e.target.closest('.meta-link') || e.target.closest('a') || e.target.closest('button')) return;

        if (state.sheet.current === 'minimized') {
            setSheetState('medium');
            return;
        }

        if (e.target.closest('#sheet-handle') || e.target.closest('.meta-title-bar')) {
            if (state.sheet.current === 'medium') {
                setSheetState('expanded');
            } else if (state.sheet.current === 'expanded') {
                setSheetState('medium');
            }
        }
    });

    panel.addEventListener('touchstart', (e) => {
        if (window.innerWidth > 768 || e.touches.length > 1) return;
        
        touchStartedOnCard = true;
        isDraggingSheet = false;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        startScrollTop = panel.scrollTop;

        const offsets = getSnapOffsets();
        startTranslateY = offsets[state.sheet.current] ?? offsets.hidden;
    }, { passive: false });

    panel.addEventListener('touchmove', (e) => {
        if (!touchStartedOnCard || window.innerWidth > 768 || e.touches.length > 1) return;

        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        const deltaX = e.touches[0].clientX - startX;

        if (!isDraggingSheet && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
            touchStartedOnCard = false;
            return;
        }

        if (state.sheet.current === 'expanded') {
            if (startScrollTop > 0 || (startScrollTop <= 0 && deltaY <= 0)) {
                return; // Native internal scroll takes over in expanded state
            }
        }

        if (Math.abs(deltaY) > 6 || isDraggingSheet) {
            isDraggingSheet = true;
            if (e.cancelable) e.preventDefault();
            panel.style.transition = 'none';
            
            const newY = Math.max(0, startTranslateY + deltaY);
            panel.style.transform = `translateY(${newY}px)`;
        }
    }, { passive: false });

    const endTouch = () => {
        if (!touchStartedOnCard || window.innerWidth > 768) return;
        touchStartedOnCard = false;
        if (!isDraggingSheet) return;
        isDraggingSheet = false;

        panel.style.transition = '';
        const deltaY = currentY - startY;

        if (Math.abs(deltaY) > 35) {
            if (deltaY > 0) {
                // Dragging Downward
                if (state.sheet.current === 'expanded') setSheetState('medium');
                else if (state.sheet.current === 'medium') setSheetState('minimized');
                else if (state.sheet.current === 'minimized') clearSelection();
            } else {
                // Dragging Upward
                if (state.sheet.current === 'minimized') setSheetState('medium');
                else if (state.sheet.current === 'medium') setSheetState('expanded');
                else if (state.sheet.current === 'hidden') setSheetState('medium');
            }
        } else {
            setSheetState(state.sheet.current);
        }
        currentY = startY = 0;
    };

    panel.addEventListener('touchend', endTouch);
    panel.addEventListener('touchcancel', endTouch);
}

/**
 * Infinite Canvas Pan, Zoom & Navigation
 */
function updateViewport() {
    DOM.viewportGroup.setAttribute('transform', `translate(${state.viewport.x}, ${state.viewport.y}) scale(${state.viewport.scale})`);

    DOM.viewportGroup.classList.remove('zoom-low', 'zoom-med');
    if (state.viewport.scale < CONFIG.ZOOM_LOW) {
        DOM.viewportGroup.classList.add('zoom-low');
    } else if (state.viewport.scale < CONFIG.ZOOM_MED) {
        DOM.viewportGroup.classList.add('zoom-med');
    }
}

function fitToScreen() {
    const people = Object.values(state.people);
    if (people.length === 0) return;

    const rect = DOM.canvasArea.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    people.forEach(p => {
        minX = Math.min(minX, p.x - CONFIG.NODE_WIDTH / 2);
        maxX = Math.max(maxX, p.x + CONFIG.NODE_WIDTH / 2);
        minY = Math.min(minY, p.y - CONFIG.NODE_HEIGHT / 2);
        maxY = Math.max(maxY, p.y + CONFIG.NODE_HEIGHT / 2);
    });

    const graphWidth = maxX - minX + 240;
    const graphHeight = maxY - minY + 240;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    const scaleX = rect.width / graphWidth;
    const scaleY = (window.innerWidth <= 768 ? rect.height * 0.75 : rect.height) / graphHeight;
    const bestScale = Math.min(Math.max(Math.min(scaleX, scaleY), CONFIG.MIN_ZOOM), CONFIG.MAX_ZOOM);

    state.viewport.scale = bestScale;
    state.viewport.x = rect.width / 2 - graphCenterX * bestScale;
    state.viewport.y = (window.innerWidth <= 768 ? rect.height * 0.40 : rect.height / 2) - graphCenterY * bestScale;
    updateViewport();
}

function focusNode(id) {
    const target = state.people[id];
    if (!target) return;

    const rect = DOM.canvasArea.getBoundingClientRect();
    const targetScale = Math.max(state.viewport.scale, 1.15);
    const targetX = rect.width / 2 - target.x * targetScale;
    const targetY = (window.innerWidth <= 768 ? rect.height * 0.32 : rect.height / 2) - target.y * targetScale;

    animateViewportTo(targetX, targetY, targetScale);
}

function animateViewportTo(targetX, targetY, targetScale) {
    const startX = state.viewport.x;
    const startY = state.viewport.y;
    const startScale = state.viewport.scale;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / CONFIG.ANIM_DURATION, 1);
        const ease = 1 - Math.pow(1 - progress, 3);

        state.viewport.x = startX + (targetX - startX) * ease;
        state.viewport.y = startY + (targetY - startY) * ease;
        state.viewport.scale = startScale + (targetScale - startScale) * ease;
        updateViewport();

        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }
    requestAnimationFrame(step);
}

/**
 * Unified Canvas Navigation & Node Click Evaluator
 * Permits dragging the map from ANY starting surface (including node boxes)
 */
function setupEventListeners() {
    DOM.canvasArea.addEventListener('pointerdown', (e) => {
        if (state.pinch.active || (e.pointerType === 'touch' && e.isPrimary === false)) return;
        state.drag.active = true;
        state.drag.startX = e.clientX;
        state.drag.startY = e.clientY;
        state.drag.panStartX = state.viewport.x;
        state.drag.panStartY = state.viewport.y;

        // Capture initial node box under cursor before setPointerCapture re-routes e.target
        const targetNode = e.target.closest('.node');
        state.drag.startNodeId = targetNode?.getAttribute('data-id') || null;

        DOM.canvasArea.classList.add('grabbing');
        try { DOM.canvasArea.setPointerCapture(e.pointerId); } catch (err) {}
    });

    DOM.canvasArea.addEventListener('pointermove', (e) => {
        if (!state.drag.active || state.pinch.active) return;
        const dx = e.clientX - state.drag.startX;
        const dy = e.clientY - state.drag.startY;
        state.viewport.x = state.drag.panStartX + dx;
        state.viewport.y = state.drag.panStartY + dy;
        updateViewport();
    });

    const endDrag = (e) => {
        if (!state.drag.active) return;
        state.drag.active = false;
        DOM.canvasArea.classList.remove('grabbing');
        try { DOM.canvasArea.releasePointerCapture(e.pointerId); } catch (err) {}
        
        // Measure displacement between pointerdown and pointerup
        const moved = Math.hypot(e.clientX - state.drag.startX, e.clientY - state.drag.startY);
        
        // If displacement >= 6 pixels, treat strictly as a map pan/drag interaction!
        if (moved >= 6) {
            state.drag.startNodeId = null;
            return;
        }

        // Otherwise (< 6px), evaluate as a deliberate tap / click interaction.
        // Because setPointerCapture forces e.target to be canvasArea, we check elementFromPoint or our recorded startNodeId.
        const elUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
        const nodeUnderCursor = elUnderCursor?.closest('.node');
        const id = nodeUnderCursor?.getAttribute('data-id') || state.drag.startNodeId;

        state.drag.startNodeId = null;
        if (id) {
            selectPerson(id);
        } else {
            clearSelection();
        }
    };
    DOM.canvasArea.addEventListener('pointerup', endDrag);
    DOM.canvasArea.addEventListener('pointercancel', endDrag);

    // Google-Maps Style Trackpad Two-Finger Scrolling and Mouse Wheel Zooming
    DOM.canvasArea.addEventListener('wheel', (e) => {
        e.preventDefault();

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 20;
        else if (e.deltaMode === 2) delta *= 100;

        const zoomFactor = Math.pow(0.992, delta);
        const newScale = Math.min(Math.max(state.viewport.scale * zoomFactor, CONFIG.MIN_ZOOM), CONFIG.MAX_ZOOM);
        const rect = DOM.canvasArea.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        state.viewport.x = mouseX - (mouseX - state.viewport.x) * (newScale / state.viewport.scale);
        state.viewport.y = mouseY - (mouseY - state.viewport.y) * (newScale / state.viewport.scale);
        state.viewport.scale = newScale;
        updateViewport();
    }, { passive: false });

    DOM.btnZoomIn?.addEventListener('click', () => {
        const rect = DOM.canvasArea.getBoundingClientRect();
        const centerX = rect.width / 2, centerY = (window.innerWidth <= 768 ? rect.height * 0.4 : rect.height / 2);
        const newScale = Math.min(state.viewport.scale * 1.3, CONFIG.MAX_ZOOM);
        state.viewport.x = centerX - (centerX - state.viewport.x) * (newScale / state.viewport.scale);
        state.viewport.y = centerY - (centerY - state.viewport.y) * (newScale / state.viewport.scale);
        state.viewport.scale = newScale;
        updateViewport();
    });

    DOM.btnZoomOut?.addEventListener('click', () => {
        const rect = DOM.canvasArea.getBoundingClientRect();
        const centerX = rect.width / 2, centerY = (window.innerWidth <= 768 ? rect.height * 0.4 : rect.height / 2);
        const newScale = Math.max(state.viewport.scale / 1.3, CONFIG.MIN_ZOOM);
        state.viewport.x = centerX - (centerX - state.viewport.x) * (newScale / state.viewport.scale);
        state.viewport.y = centerY - (centerY - state.viewport.y) * (newScale / state.viewport.scale);
        state.viewport.scale = newScale;
        updateViewport();
    });

    DOM.btnZoomFit?.addEventListener('click', fitToScreen);

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            if (DOM.metadataPanel) {
                DOM.metadataPanel.style.transform = '';
                DOM.metadataPanel.style.overflowY = '';
            }
            document.body.classList.remove('sheet-hidden', 'sheet-minimized', 'sheet-medium', 'sheet-expanded');
        } else if (state.sheet.current !== 'hidden') {
            setSheetState(state.sheet.current);
        }

        if (Object.keys(state.people).length > 0 && !state.selectedId) {
            fitToScreen();
        }
    });

    setupSearchAutoComplete();
}

/**
 * Native Touch Gestures (Multi-touch two-finger pinch-to-zoom & simultaneous panning)
 */
function setupTouchGestures() {
    const canvas = DOM.canvasArea;
    if (!canvas) return;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 2) {
            e.preventDefault();
            state.drag.active = false;
            state.pinch.active = true;

            const t1 = e.touches[0];
            const t2 = e.touches[1];
            state.pinch.initialDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            state.pinch.initialScale = state.viewport.scale;
            state.pinch.midX = (t1.clientX + t2.clientX) / 2;
            state.pinch.midY = (t1.clientY + t2.clientY) / 2;
            state.pinch.panStartX = state.viewport.x;
            state.pinch.panStartY = state.viewport.y;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (!state.pinch.active || e.touches.length < 2) return;
        e.preventDefault();

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const currentMidX = (t1.clientX + t2.clientX) / 2;
        const currentMidY = (t1.clientY + t2.clientY) / 2;

        const scaleRatio = currentDist / (state.pinch.initialDistance || 1);
        const newScale = Math.min(Math.max(state.pinch.initialScale * scaleRatio, CONFIG.MIN_ZOOM), CONFIG.MAX_ZOOM);

        const rect = canvas.getBoundingClientRect();
        const initRelX = state.pinch.midX - rect.left;
        const initRelY = state.pinch.midY - rect.top;
        const currRelX = currentMidX - rect.left;
        const currRelY = currentMidY - rect.top;

        const unscaledX = (initRelX - state.pinch.panStartX) / state.pinch.initialScale;
        const unscaledY = (initRelY - state.pinch.panStartY) / state.pinch.initialScale;

        state.viewport.x = currRelX - unscaledX * newScale;
        state.viewport.y = currRelY - unscaledY * newScale;
        state.viewport.scale = newScale;
        updateViewport();
    }, { passive: false });

    const endPinch = (e) => {
        if (!state.pinch.active) return;
        if (e.touches.length < 2) {
            state.pinch.active = false;
            if (e.touches.length === 1) {
                state.drag.active = true;
                state.drag.startX = e.touches[0].clientX;
                state.drag.startY = e.touches[0].clientY;
                state.drag.panStartX = state.viewport.x;
                state.drag.panStartY = state.viewport.y;
            }
        }
    };

    canvas.addEventListener('touchend', endPinch);
    canvas.addEventListener('touchcancel', endPinch);
}

/**
 * Search and Prefix Auto-Complete Handling
 */
function setupSearchAutoComplete() {
    const input = DOM.searchInput;
    const dropdown = DOM.autocompleteDropdown;
    if (!input || !dropdown) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        state.search.selectedIndex = -1;

        if (!query) {
            dropdown.style.display = 'none';
            state.search.matches = [];
            return;
        }

        const allPeople = Object.values(state.people);
        const getSearchText = p => `${p.name} ${p.nickname || ''}`.toLowerCase();
        const prefixMatches = allPeople.filter(p => getSearchText(p).startsWith(query));
        const partialMatches = allPeople.filter(p => !getSearchText(p).startsWith(query) && getSearchText(p).includes(query));
        const matches = [...prefixMatches, ...partialMatches].slice(0, 8);

        state.search.matches = matches;
        if (matches.length === 0) {
            dropdown.innerHTML = '<li class="autocomplete-item" style="color: var(--text-muted); cursor: default;">No family members found</li>';
            dropdown.style.display = 'block';
            return;
        }

        dropdown.innerHTML = matches.map((m, i) => `
            <li class="autocomplete-item" data-index="${i}" data-id="${m.id}">
                <span>${m.nickname ? `${m.name} "${m.nickname}"` : m.name}</span>
                <span class="item-sub">${m.meta?.birth_year || '?'} – ${m.meta?.death_year || 'Present'} • ${m.meta?.occupation || 'Family Member'}</span>
            </li>
        `).join('');
        dropdown.style.display = 'block';
    });

    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.autocomplete-item');
        if (!item || !item.hasAttribute('data-id')) return;
        
        const targetId = item.getAttribute('data-id');
        selectAndFocusFromSearch(targetId);
    });

    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item[data-id]');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.search.selectedIndex = (state.search.selectedIndex + 1) % items.length;
            updateDropdownSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.search.selectedIndex = (state.search.selectedIndex - 1 + items.length) % items.length;
            updateDropdownSelection(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (state.search.selectedIndex >= 0 && items[state.search.selectedIndex]) {
                const id = items[state.search.selectedIndex].getAttribute('data-id');
                selectAndFocusFromSearch(id);
            } else if (state.search.matches.length > 0) {
                selectAndFocusFromSearch(state.search.matches[0].id);
            }
        } else if (e.key === 'Escape') {
            dropdown.style.display = 'none';
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            dropdown.style.display = 'none';
        }
    });
}

function updateDropdownSelection(items) {
    items.forEach((el, idx) => {
        el.classList.toggle('active', idx === state.search.selectedIndex);
        if (idx === state.search.selectedIndex) el.scrollIntoView({ block: 'nearest' });
    });
}

function selectAndFocusFromSearch(id) {
    const person = state.people[id];
    if (!person) return;

    DOM.searchInput.value = person.name;
    DOM.autocompleteDropdown.style.display = 'none';

    selectPerson(id);
    focusNode(id);
}
