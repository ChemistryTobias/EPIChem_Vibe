from typing import Optional

from .schema import GeometryDescriptor


def find_free_slot_2d(
    parent: GeometryDescriptor, existing: list[GeometryDescriptor], new: GeometryDescriptor
) -> Optional[GeometryDescriptor]:
    """Find a free (x, y) for `new` inside `parent`'s footprint.
    
    ```
    WHILE new box still in parent box
        IF no other box collides
            RETURN new coordinates
        ELSE 
            DO move one new box along x and y with step size being its own dimensions (nx, ny)
    
    RETURN none 
    ```
    """
    x0, y0, z0 = parent.box_position_xyz
    px, py, _ = parent.box_dimension_xyz
    nx, ny, _ = new.box_dimension_xyz
    
    if nx > px or ny > py:
        return None

    x, y = x0, y0

    while (y + ny <= y0 + py):
        
        while (x + nx <= x0 + px):
            collision = False
            for box in existing:
                bx, by, _ = box.box_position_xyz
                bdimx, bdimy, _ = box.box_dimension_xyz
                if x < bx + bdimx and x + nx > bx and y < by + bdimy and y + ny > by:
                    collision = True
                    break
            
            if not collision:
                return new.model_copy(update={"box_position_xyz": (x, y, z0)})
                
            x = x + nx
        
        y = y + ny

    return None

def find_free_slot_3d(
    parent: GeometryDescriptor, existing: list[GeometryDescriptor], new: GeometryDescriptor
) -> Optional[GeometryDescriptor]:
    """3D placement (also stacking along z) -- not implemented yet."""
    raise NotImplementedError
