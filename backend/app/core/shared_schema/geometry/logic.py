from typing import Optional

from .schema import GeometryDescriptor


def find_free_slot_2d(
    parent: GeometryDescriptor, existing: list[GeometryDescriptor], new: GeometryDescriptor
) -> Optional[GeometryDescriptor]:
    """Find a free (x, y) for `new` inside `parent`'s footprint.

    Positions are **parent-local**: a child's `box_position_xyz` is measured
    from its parent's own corner, not in the parent's parent's frame -- the
    same convention `internal_positions` uses and the layout canvas draws
    with (each level is its own floor starting at 0, 0). So the parent's
    position plays no part here, only its extent; using it put every child
    of a lab that wasn't at the site origin off that lab's floor.
    
    ```
    WHILE new box still in parent box
        IF no other box collides
            RETURN new coordinates
        ELSE 
            DO move one new box along x and y with step size being its own dimensions (nx, ny)
    
    RETURN none 
    ```
    """
    px, py, _ = parent.box_dimension_xyz
    nx, ny, _ = new.box_dimension_xyz

    if nx <= 0 or ny <= 0 or nx > px or ny > py:
        return None

    def collides(x: float, y: float) -> bool:
        for box in existing:
            bx, by, _ = box.box_position_xyz
            bw, bd, _ = box.box_dimension_xyz
            if x < bx + bw and x + nx > bx and y < by + bd and y + ny > by:
                return True
        return False

    # Step by whole multiples (not by accumulating floats), and start every
    # row back at x = 0 -- otherwise only the first row is ever searched.
    eps = 1e-9
    for row in range(int((py + eps) // ny)):
        y = round(row * ny, 6)
        for col in range(int((px + eps) // nx)):
            x = round(col * nx, 6)
            if not collides(x, y):
                return new.model_copy(update={"box_position_xyz": (x, y, 0.0)})

    return None

def find_free_slot_3d(
    parent: GeometryDescriptor, existing: list[GeometryDescriptor], new: GeometryDescriptor
) -> Optional[GeometryDescriptor]:
    """3D placement (also stacking along z) -- not implemented yet."""
    raise NotImplementedError
