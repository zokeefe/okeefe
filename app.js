/**
 * O'Keefe Family Tree Visualization Engine
 * Pure Vanilla JavaScript implementation with zero dependencies.
 * Features hierarchical graph layout, infinite canvas navigation, prefix auto-complete search,
 * direct ancestry highlighting, mobile bottom sheets, and multi-touch pinch-to-zoom.
 */

// Visual Configuration and Zoom Thresholds
const CONFIG = {
    NODE_WIDTH: 220,
    NODE_HEIGHT: 104,
    GEN_HEIGHT: 210,         // Vertical distance between generations
    NODE_GAP_X: 50,          // Minimum horizontal gap between separate families/nodes
    COUPLE_GAP_X: 24,        // Horizontal gap between partners/spouses
    ZOOM_LOW: 0.60,          // Scale threshold below which only names are shown
    ZOOM_MED: 1.00,          // Scale threshold below which dates are shown but secondary meta is hidden
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
    loadFamilyTreeData('family_tree.json');
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
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const rawData = await response.json();
        
        processData(rawData);
        computeHierarchicalLayout();
        renderGraph();
        fitToScreen();
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
 */
function renderGraph() {
    DOM.edgesLayer.innerHTML = '';
    DOM.nodesLayer.innerHTML = '';

    state.couples.forEach(c => {
        const p1 = state.people[c.p1];
        const p2 = state.people[c.p2];

        const couplePath = createSVGElement('path', {
            d: `M ${p1.x} ${c.y} L ${p2.x} ${c.y}`,
            class: 'edge couple-edge',
            'data-parent1': p1.id,
            'data-parent2': p2.id
        });
        DOM.edgesLayer.appendChild(couplePath);

        if (c.children.length > 0) {
            const busY = c.y + CONFIG.NODE_HEIGHT / 2 + (CONFIG.GEN_HEIGHT - CONFIG.NODE_HEIGHT) / 2;
            
            const dropPath = createSVGElement('path', {
                d: `M ${c.midX} ${c.y} L ${c.midX} ${busY}`,
                class: 'edge parent-drop',
                'data-parent1': p1.id,
                'data-parent2': p2.id
            });
            DOM.edgesLayer.appendChild(dropPath);

            const childrenX = c.children.map(cid => state.people[cid].x);
            const minX = Math.min(c.midX, ...childrenX);
            const maxX = Math.max(c.midX, ...childrenX);

            const busPath = createSVGElement('path', {
                d: `M ${minX} ${busY} L ${maxX} ${busY}`,
                class: 'edge bus-line',
                'data-parent1': p1.id,
                'data-parent2': p2.id
            });
            DOM.edgesLayer.appendChild(busPath);

            c.children.forEach(cid => {
                const child = state.people[cid];
                const childDrop = createSVGElement('path', {
                    d: `M ${child.x} ${busY} L ${child.x} ${child.y - CONFIG.NODE_HEIGHT / 2}`,
                    class: 'edge child-drop',
                    'data-parent1': p1.id,
                    'data-parent2': p2.id,
                    'data-child': cid
                });
                DOM.edgesLayer.appendChild(childDrop);
            });
        }
    });

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
                    'data-child': cid
                });
                DOM.edgesLayer.appendChild(path);
            }
        });
    });

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
        textName.textContent = truncateText(p.name, 22);
        nodeGroup.appendChild(textName);

        const textDates = createSVGElement('text', {
            class: 'node-text-dates',
            x: CONFIG.NODE_WIDTH / 2,
            y: 58
        });
        const by = p.meta?.birth_year || '?';
        const dy = p.meta?.death_year || '';
        textDates.textContent = dy ? `${by} – ${dy}` : `b. ${by}`;
        nodeGroup.appendChild(textDates);

        const textMeta = createSVGElement('text', {
            class: 'node-text-meta',
            x: CONFIG.NODE_WIDTH / 2,
            y: 82
        });
        const metaDetail = p.meta?.occupation || p.meta?.town_of_residence || '';
        textMeta.textContent = truncateText(metaDetail, 28);
        nodeGroup.appendChild(textMeta);

        nodeGroup.addEventListener('click', (e) => {
            e.stopPropagation();
            selectPerson(p.id);
            if (window.innerWidth <= 768) {
                openBottomSheet();
            }
        });

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
 * Node Selection & Ancestry Lineage Highlighting
 */
function selectPerson(id) {
    if (state.selectedId === id && window.innerWidth > 768) return;
    
    state.selectedId = id;
    if (!id) {
        clearSelection();
        return;
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

    const edges = DOM.edgesLayer.querySelectorAll('.edge');
    edges.forEach(edge => {
        const p1 = edge.getAttribute('data-parent1');
        const p2 = edge.getAttribute('data-parent2');
        const child = edge.getAttribute('data-child');

        edge.classList.remove('ancestor-edge', 'descendant-edge', 'dimmed');

        const isAncestorLink = (child ? (child === id || ancestors.has(child)) : true) && 
                               ((p1 && (p1 === id || ancestors.has(p1))) || (p2 && (p2 === id || ancestors.has(p2))));
        const isDescendantLink = (child ? (child === id || descendants.has(child)) : false) || 
                                 (!child && ((p1 && (p1 === id || descendants.has(p1))) || (p2 && (p2 === id || descendants.has(p2)))));

        if (isAncestorLink && (child ? ancestors.has(child) || child === id : (ancestors.has(p1) || ancestors.has(p2)))) {
            edge.classList.add('ancestor-edge');
        } else if (isDescendantLink && (child ? descendants.has(child) : true)) {
            edge.classList.add('descendant-edge');
        } else {
            edge.classList.add('dimmed');
        }
    });

    renderMetadata(target);
    if (window.innerWidth <= 768) {
        openBottomSheet();
    }
}

function clearSelection() {
    state.selectedId = null;
    DOM.viewportGroup.classList.remove('has-selection');
    
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
        closeBottomSheet();
    }
}

/**
 * Render Dynamic Metadata Card
 */
function renderMetadata(p) {
    if (!DOM.metadataContent) return;
    const by = p.meta?.birth_year || 'Unknown';
    const dy = p.meta?.death_year || 'Present';
    const bday = p.meta?.birthday || null;

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
                <h2 class="meta-name">${p.name}</h2>
                <span class="meta-badge ${p.gender || 'M'}">${p.gender === 'F' ? 'Female' : 'Male'}</span>
            </div>
            <div class="meta-rows">
                <div class="meta-row">
                    <span class="meta-label">Lifespan</span>
                    <span class="meta-value">${by} – ${dy} ${bday ? `(${bday})` : ''}</span>
                </div>
                ${p.meta?.occupation ? `
                <div class="meta-row">
                    <span class="meta-label">Occupation</span>
                    <span class="meta-value">${p.meta.occupation}</span>
                </div>` : ''}
                ${p.meta?.town_of_residence || p.meta?.country_of_residence ? `
                <div class="meta-row">
                    <span class="meta-label">Residence</span>
                    <span class="meta-value">${[p.meta.town_of_residence, p.meta.country_of_residence].filter(Boolean).join(', ')}</span>
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
                if (window.innerWidth <= 768) {
                    openBottomSheet();
                }
            }
        });
    });
}

/**
 * Mobile Bottom Sheet Handlers
 */
function setupMobileBottomSheet() {
    const panel = DOM.metadataPanel;
    const handle = DOM.sheetHandle;
    if (!panel || !handle) return;

    let startY = 0;
    let currentY = 0;
    let isDraggingSheet = false;

    handle.addEventListener('click', () => {
        if (window.innerWidth > 768) return;
        if (panel.classList.contains('sheet-open')) {
            peekBottomSheet();
        } else if (panel.classList.contains('sheet-peek') || state.selectedId) {
            openBottomSheet();
        }
    });

    handle.addEventListener('touchstart', (e) => {
        if (window.innerWidth > 768) return;
        isDraggingSheet = true;
        startY = e.touches[0].clientY;
        panel.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
        if (!isDraggingSheet || window.innerWidth > 768) return;
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;
        if (deltaY > 0) {
            panel.style.transform = `translateY(${Math.min(deltaY, panel.offsetHeight - 48)}px)`;
        }
    }, { passive: true });

    const endTouch = () => {
        if (!isDraggingSheet || window.innerWidth > 768) return;
        isDraggingSheet = false;
        panel.style.transition = '';
        const deltaY = currentY - startY;
        if (deltaY > 40) {
            peekBottomSheet();
        } else {
            openBottomSheet();
        }
        currentY = startY = 0;
    };

    handle.addEventListener('touchend', endTouch);
    handle.addEventListener('touchcancel', endTouch);
}

function openBottomSheet() {
    if (window.innerWidth > 768 || !DOM.metadataPanel) return;
    DOM.metadataPanel.style.transform = '';
    DOM.metadataPanel.classList.remove('sheet-peek');
    DOM.metadataPanel.classList.add('sheet-open');
    document.body.classList.remove('sheet-peek-active');
    document.body.classList.add('sheet-active');
}

function peekBottomSheet() {
    if (window.innerWidth > 768 || !DOM.metadataPanel) return;
    DOM.metadataPanel.style.transform = '';
    DOM.metadataPanel.classList.remove('sheet-open');
    DOM.metadataPanel.classList.add('sheet-peek');
    document.body.classList.remove('sheet-active');
    document.body.classList.add('sheet-peek-active');
}

function closeBottomSheet() {
    if (!DOM.metadataPanel) return;
    DOM.metadataPanel.style.transform = '';
    DOM.metadataPanel.classList.remove('sheet-open', 'sheet-peek');
    document.body.classList.remove('sheet-active', 'sheet-peek-active');
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
    state.viewport.y = (window.innerWidth <= 768 ? rect.height * 0.45 : rect.height / 2) - graphCenterY * bestScale;
    updateViewport();
}

function focusNode(id) {
    const target = state.people[id];
    if (!target) return;

    const rect = DOM.canvasArea.getBoundingClientRect();
    const targetScale = Math.max(state.viewport.scale, 1.15);
    const targetX = rect.width / 2 - target.x * targetScale;
    // On mobile, position node slightly in the top half so bottom sheet doesn't cover it
    const targetY = (window.innerWidth <= 768 ? rect.height * 0.35 : rect.height / 2) - target.y * targetScale;

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
 * Single-Pointer & Mouse Navigation Event Listeners
 */
function setupEventListeners() {
    DOM.canvasArea.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.node') || state.pinch.active || (e.pointerType === 'touch' && e.isPrimary === false)) return;
        state.drag.active = true;
        state.drag.startX = e.clientX;
        state.drag.startY = e.clientY;
        state.drag.panStartX = state.viewport.x;
        state.drag.panStartY = state.viewport.y;
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
        
        const moved = Math.hypot(e.clientX - state.drag.startX, e.clientY - state.drag.startY);
        if (moved < 5 && !e.target.closest('.node')) clearSelection();
    };
    DOM.canvasArea.addEventListener('pointerup', endDrag);
    DOM.canvasArea.addEventListener('pointercancel', endDrag);

    // Google-Maps Style Trackpad Two-Finger Scrolling and Mouse Wheel Zooming
    DOM.canvasArea.addEventListener('wheel', (e) => {
        e.preventDefault();

        // Normalize deltas across trackpads (pixel mode) and standard mouse wheels (line mode)
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
        if (e.target.closest('.node') && e.touches.length === 1) return;
        
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
                // Resume single touch panning smoothly without jumping
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
        const prefixMatches = allPeople.filter(p => p.name.toLowerCase().startsWith(query));
        const partialMatches = allPeople.filter(p => !p.name.toLowerCase().startsWith(query) && p.name.toLowerCase().includes(query));
        const matches = [...prefixMatches, ...partialMatches].slice(0, 8);

        state.search.matches = matches;
        if (matches.length === 0) {
            dropdown.innerHTML = '<li class="autocomplete-item" style="color: var(--text-muted); cursor: default;">No family members found</li>';
            dropdown.style.display = 'block';
            return;
        }

        dropdown.innerHTML = matches.map((m, i) => `
            <li class="autocomplete-item" data-index="${i}" data-id="${m.id}">
                <span>${m.name}</span>
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
    if (window.innerWidth <= 768) {
        openBottomSheet();
    }
}
