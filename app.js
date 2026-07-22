/**
 * O'Keefe Family Tree Visualization Engine
 * Pure Vanilla JavaScript implementation with zero dependencies.
 * Features hierarchical graph layout, infinite canvas navigation, prefix auto-complete search,
 * and direct ancestry highlighting.
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
        scale: 1.0,
        targetX: 0,
        targetY: 0,
        targetScale: 1.0,
        isAnimating: false
    },
    drag: {
        active: false,
        startX: 0,
        startY: 0,
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
        if (DOM.metadataPanel) {
            DOM.metadataPanel.innerHTML = `
                <div class="meta-placeholder" style="color: #ef4444;">
                    <strong>Error loading dataset:</strong><br>
                    Could not fetch ${url}. Ensure you are serving index.html over a local HTTP server.
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

    // 1. First pass: Initialize person records
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

    // 2. Second pass: Link lineage and infer couples from shared children
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

        // If both parents are in dataset, register them as partners/couple
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
 * Assigns generation depth (Y) and minimizes branch tangling for spacing (X)
 */
function computeHierarchicalLayout() {
    const people = Object.values(state.people);
    
    // 1. Determine Generation Depth (Y Axis)
    // Find roots (individuals with no parents in dataset)
    const roots = people.filter(p => p.parents.length === 0);
    roots.forEach(r => { r.gen = 0; });

    // Iteration to propagate generations down children and horizontally across spouses
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 50) {
        changed = false;
        iterations++;

        people.forEach(p => {
            // Child generation is max(parent generations) + 1
            if (p.parents.length > 0) {
                const maxParentGen = Math.max(...p.parents.map(parentId => state.people[parentId].gen));
                if (maxParentGen !== -1 && p.gen !== maxParentGen + 1) {
                    p.gen = maxParentGen + 1;
                    changed = true;
                }
            }

            // Align partner generations if neither is an ancestor of the other
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

    // Fallback for any disconnected nodes
    people.forEach(p => {
        if (p.gen === -1) p.gen = 0;
        p.y = p.gen * CONFIG.GEN_HEIGHT;
    });

    // Assign generation to couples
    state.couples.forEach(c => {
        c.gen = Math.max(state.people[c.p1].gen, state.people[c.p2].gen);
        c.y = c.gen * CONFIG.GEN_HEIGHT;
    });

    // Group individuals by generation
    state.generations = {};
    people.forEach(p => {
        if (!state.generations[p.gen]) state.generations[p.gen] = [];
        state.generations[p.gen].push(p);
    });

    // 2. Horizontal Placement (X Axis)
    // Group partners adjacent to each other in initial ordering
    const maxGen = Math.max(...Object.keys(state.generations).map(Number));
    
    // Build ordered sibling clusters per generation
    for (let g = 0; g <= maxGen; g++) {
        const layer = state.generations[g] || [];
        const placed = new Set();
        const ordered = [];

        layer.forEach(p => {
            if (placed.has(p.id)) return;
            placed.add(p.id);
            ordered.push(p);

            // Immediately place partners adjacent
            p.partners.forEach(partnerId => {
                if (!placed.has(partnerId) && state.people[partnerId].gen === g) {
                    placed.add(partnerId);
                    ordered.push(state.people[partnerId]);
                }
            });
        });
        state.generations[g] = ordered;
    }

    // Iterative relaxation to align parents over children & children under parents
    for (let pass = 0; pass < 6; pass++) {
        // Top-down: align children toward parent midpoints
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

        // Bottom-up: align parents toward children midpoints
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

    // Final layer spacing & center overall tree around X = 0
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

    // Update couple midX coordinates
    state.couples.forEach(c => {
        c.midX = (state.people[c.p1].x + state.people[c.p2].x) / 2;
    });
}

/**
 * Enforce minimum horizontal distance between nodes in a generation layer
 */
function spaceOutLayer(layer) {
    if (layer.length === 0) return;
    
    // Sort by targetX or current X while keeping partners grouped
    layer.sort((a, b) => (a.targetX !== undefined ? a.targetX - b.targetX : a.x - b.x));

    let currentX = 0;
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
        currentX = p.x;
    }

    // Center layer around its average coordinate to avoid drift
    const layerCenter = layer.reduce((sum, p) => sum + p.x, 0) / layer.length;
    layer.forEach(p => { p.x -= layerCenter; });
}

/**
 * Render edges and nodes into the SVG viewport
 */
function renderGraph() {
    DOM.edgesLayer.innerHTML = '';
    DOM.nodesLayer.innerHTML = '';

    // 1. Draw Edges
    // Draw couple partnerships and descent paths to shared children
    state.couples.forEach(c => {
        const p1 = state.people[c.p1];
        const p2 = state.people[c.p2];

        // Horizontal coupling bar between partners
        const couplePath = createSVGElement('path', {
            d: `M ${p1.x} ${c.y} L ${p2.x} ${c.y}`,
            class: 'edge couple-edge',
            'data-parent1': p1.id,
            'data-parent2': p2.id
        });
        DOM.edgesLayer.appendChild(couplePath);

        if (c.children.length > 0) {
            const busY = c.y + CONFIG.NODE_HEIGHT / 2 + (CONFIG.GEN_HEIGHT - CONFIG.NODE_HEIGHT) / 2;
            
            // Vertical drop from couple mid point down to horizontal bus
            const dropPath = createSVGElement('path', {
                d: `M ${c.midX} ${c.y} L ${c.midX} ${busY}`,
                class: 'edge parent-drop',
                'data-parent1': p1.id,
                'data-parent2': p2.id
            });
            DOM.edgesLayer.appendChild(dropPath);

            // Calculate span of children for horizontal bus bar
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

            // Drops from horizontal bus to each child
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

    // Handle single parents (parent without partner in dataset)
    Object.values(state.people).forEach(p => {
        p.children.forEach(cid => {
            const child = state.people[cid];
            const otherParent = child.parents.find(id => id !== p.id);
            if (!otherParent) {
                // Draw direct connection for single known parent
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

    // 2. Draw Nodes (People)
    Object.values(state.people).forEach(p => {
        const nodeGroup = createSVGElement('g', {
            id: `node-${p.id}`,
            class: `node ${p.gender || 'M'}`,
            transform: `translate(${p.x - CONFIG.NODE_WIDTH / 2}, ${p.y - CONFIG.NODE_HEIGHT / 2})`,
            'data-id': p.id
        });

        // Box container
        const box = createSVGElement('rect', {
            class: 'node-box',
            width: CONFIG.NODE_WIDTH,
            height: CONFIG.NODE_HEIGHT
        });
        nodeGroup.appendChild(box);

        // Priority 1: Name
        const textName = createSVGElement('text', {
            class: 'node-text-name',
            x: CONFIG.NODE_WIDTH / 2,
            y: 32
        });
        textName.textContent = truncateText(p.name, 22);
        nodeGroup.appendChild(textName);

        // Priority 2: Birth year - Death year
        const textDates = createSVGElement('text', {
            class: 'node-text-dates',
            x: CONFIG.NODE_WIDTH / 2,
            y: 58
        });
        const by = p.meta?.birth_year || '?';
        const dy = p.meta?.death_year || '';
        textDates.textContent = dy ? `${by} – ${dy}` : `b. ${by}`;
        nodeGroup.appendChild(textDates);

        // Priority 3: Additional Metadata (Occupation / Location)
        const textMeta = createSVGElement('text', {
            class: 'node-text-meta',
            x: CONFIG.NODE_WIDTH / 2,
            y: 82
        });
        const metaDetail = p.meta?.occupation || p.meta?.town_of_residence || '';
        textMeta.textContent = truncateText(metaDetail, 28);
        nodeGroup.appendChild(textMeta);

        // Click selection listener
        nodeGroup.addEventListener('click', (e) => {
            e.stopPropagation();
            selectPerson(p.id);
        });

        DOM.nodesLayer.appendChild(nodeGroup);
    });
}

/**
 * Helper to create SVG elements with namespaces and attributes
 */
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
 * Node Selection & Direct Ancestry Lineage Calculation
 */
function selectPerson(id) {
    if (state.selectedId === id) {
        // Optional toggle off on double select, or just re-focus
        return;
    }
    
    state.selectedId = id;

    if (!id) {
        clearSelection();
        return;
    }

    const target = state.people[id];
    if (!target) return;

    // 1. Calculate recursive Direct Ancestors set
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

    // 2. Calculate recursive Direct Descendants set
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

    // 3. Update Visual States (Highlight vs Dim)
    DOM.viewportGroup.classList.add('has-selection');

    // Update Nodes
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

    // Update Edges
    const edges = DOM.edgesLayer.querySelectorAll('.edge');
    edges.forEach(edge => {
        const p1 = edge.getAttribute('data-parent1');
        const p2 = edge.getAttribute('data-parent2');
        const child = edge.getAttribute('data-child');

        edge.classList.remove('ancestor-edge', 'descendant-edge', 'dimmed');

        // Check if edge belongs to ancestor tree (connecting child in ancestors/self to parent in ancestors)
        const isAncestorLink = (child ? (child === id || ancestors.has(child)) : true) && 
                               ((p1 && (p1 === id || ancestors.has(p1))) || (p2 && (p2 === id || ancestors.has(p2))));
        
        // Check if edge belongs to descendant tree
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

    // 4. Update Sidebar Dynamic Metadata Panel
    renderMetadata(target);
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

    if (DOM.metadataPanel) {
        DOM.metadataPanel.innerHTML = `
            <p class="meta-header">Dynamic Metadata</p>
            <div class="meta-placeholder">
                Select any person from the family tree graph or use the search bar above to inspect details and illuminate direct lineage.
            </div>
        `;
    }
}

/**
 * Render Dynamic Metadata Card in the left sidebar
 */
function renderMetadata(p) {
    const by = p.meta?.birth_year || 'Unknown';
    const dy = p.meta?.death_year || 'Present';
    const bday = p.meta?.birthday || null;

    // Build interactive parent links
    const parentLinks = p.parents.length > 0 
        ? p.parents.map(pid => `<span class="meta-link" data-id="${pid}">${state.people[pid]?.name || pid}</span>`).join(', ')
        : 'None recorded';

    // Build interactive children links
    const childrenLinks = p.children.length > 0
        ? p.children.map(cid => `<span class="meta-link" data-id="${cid}">${state.people[cid]?.name || cid}</span>`).join(', ')
        : 'None recorded';

    // Build interactive spouse/partner links
    const partnerLinks = p.partners.length > 0
        ? p.partners.map(pid => `<span class="meta-link" data-id="${pid}">${state.people[pid]?.name || pid}</span>`).join(', ')
        : 'None recorded';

    DOM.metadataPanel.innerHTML = `
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

    // Attach link click events to navigate directly to relatives
    DOM.metadataPanel.querySelectorAll('.meta-link').forEach(link => {
        link.addEventListener('click', () => {
            const targetId = link.getAttribute('data-id');
            if (targetId && state.people[targetId]) {
                selectPerson(targetId);
                focusNode(targetId);
            }
        });
    });
}

/**
 * Infinite Canvas Pan, Zoom, and Smooth Navigation
 */
function updateViewport() {
    DOM.viewportGroup.setAttribute('transform', `translate(${state.viewport.x}, ${state.viewport.y}) scale(${state.viewport.scale})`);

    // Manage zoom detail class visibility thresholds
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
    const scaleY = rect.height / graphHeight;
    const bestScale = Math.min(Math.max(Math.min(scaleX, scaleY), CONFIG.MIN_ZOOM), CONFIG.MAX_ZOOM);

    state.viewport.scale = bestScale;
    state.viewport.x = rect.width / 2 - graphCenterX * bestScale;
    state.viewport.y = rect.height / 2 - graphCenterY * bestScale;
    updateViewport();
}

/**
 * Smoothly pan and zoom canvas to center directly on a specific target person node
 */
function focusNode(id) {
    const target = state.people[id];
    if (!target) return;

    const rect = DOM.canvasArea.getBoundingClientRect();
    const targetScale = Math.max(state.viewport.scale, 1.15); // Ensure high detail zoom level
    const targetX = rect.width / 2 - target.x * targetScale;
    const targetY = rect.height / 2 - target.y * targetScale;

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
        
        // Ease-out cubic calculation
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
 * Event Listeners Configuration
 */
function setupEventListeners() {
    // Canvas Click & Drag Panning
    DOM.canvasArea.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.node')) return; // Allow node click to process instead of drag
        state.drag.active = true;
        state.drag.startX = e.clientX;
        state.drag.startY = e.clientY;
        state.drag.panStartX = state.viewport.x;
        state.drag.panStartY = state.viewport.y;
        DOM.canvasArea.classList.add('grabbing');
        DOM.canvasArea.setPointerCapture(e.pointerId);
    });

    DOM.canvasArea.addEventListener('pointermove', (e) => {
        if (!state.drag.active) return;
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
        
        // If minimal movement occurred, treat as background click to clear selection
        const moved = Math.hypot(e.clientX - state.drag.startX, e.clientY - state.drag.startY);
        if (moved < 5) clearSelection();
    };
    DOM.canvasArea.addEventListener('pointerup', endDrag);
    DOM.canvasArea.addEventListener('pointercancel', endDrag);

    // Mouse Wheel / Trackpad Natural Panning and Zooming
    DOM.canvasArea.addEventListener('wheel', (e) => {
        e.preventDefault();

        // Trackpad pinch-zoom or Ctrl+Wheel sets ctrlKey true
        if (e.ctrlKey || e.metaKey) {
            const zoomFactor = Math.pow(0.99, e.deltaY);
            const newScale = Math.min(Math.max(state.viewport.scale * zoomFactor, CONFIG.MIN_ZOOM), CONFIG.MAX_ZOOM);
            const rect = DOM.canvasArea.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            state.viewport.x = mouseX - (mouseX - state.viewport.x) * (newScale / state.viewport.scale);
            state.viewport.y = mouseY - (mouseY - state.viewport.y) * (newScale / state.viewport.scale);
            state.viewport.scale = newScale;
            updateViewport();
        } else {
            // Standard wheel / two-finger trackpad scrolling pans canvas naturally
            state.viewport.x -= e.deltaX * 0.9;
            state.viewport.y -= e.deltaY * 0.9;
            updateViewport();
        }
    }, { passive: false });

    // UI Zoom Control Buttons
    DOM.btnZoomIn?.addEventListener('click', () => {
        const rect = DOM.canvasArea.getBoundingClientRect();
        const centerX = rect.width / 2, centerY = rect.height / 2;
        const newScale = Math.min(state.viewport.scale * 1.3, CONFIG.MAX_ZOOM);
        state.viewport.x = centerX - (centerX - state.viewport.x) * (newScale / state.viewport.scale);
        state.viewport.y = centerY - (centerY - state.viewport.y) * (newScale / state.viewport.scale);
        state.viewport.scale = newScale;
        updateViewport();
    });

    DOM.btnZoomOut?.addEventListener('click', () => {
        const rect = DOM.canvasArea.getBoundingClientRect();
        const centerX = rect.width / 2, centerY = rect.height / 2;
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

    // Search input prefix auto-complete matching
    setupSearchAutoComplete();
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

        // Prefix match first, then partial match fallback
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

    // Keyboard navigation (Arrows + Enter)
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
                // Default to top match on Enter
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
