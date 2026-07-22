# Design

## Source data

Store in single json file, structured as rows of entries:

{
    id:<hash>,
    name:string,
    mother:<id>,
    father:<id>,
    gender:M|F
    meta: {
        birth_year:int,
        death_year:int,
        birthday:string,
        occupation:string,
        country_of_residence:string,
        town_of_residence:string,
        about:string,
    }
}

Note that relationships are inferred from shared-children.

## Website design

### Appearance

+ Like Google-Maps:
    + Two sections, split horizontally (side-by-side, two-column layout)
        + Left section (20%):
            + Top-aligned:
                + O'Keefe family logo (logo.webp)
                + Search text bar, based on person name
                    + Auto-complete prefix matching
                    + On "enter", if a match, adjusts left-section to focus on
                      found person node
                + dynamic metadata
        + Right section (80%)
            + Infinite canvas
            + Tree-graph
                + Nodes are people
                    + Colored boxes, based on gender
                    + Dynamic content, based on zoom
                        + In priority order:
                            + Name
                            + Birth year - Death year
                            + <other metadata, if available>
            + Navigate with natural scrolling, zoom in/out
            + On select (left click) a node:
                + Shows all meta data in "dynamic metadata" section
                + Highlights tree edges in direct ancestry tree
                    + One color for ancestor tree another for descendant tree
                + Applies minor saturation-reduction ("greying-out") of nodes
                  not in direct ancestry tree (direct ancestors or descendants)
+ Themeable

