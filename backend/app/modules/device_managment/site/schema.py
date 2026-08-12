from typing import Optional

import uuid
from sqlalchemy import ForeignKey, String, create_engine, types
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session

engine = create_engine("sqlite://", echo=True)
connection = 


class Base(DeclarativeBase):
    pass

class DBSite(Base):
    __tablename__ = "dm_sites"

    uuid: Mapped[types.Uuid] = mapped_column(types.Uuid, primary_key=True) 
    name: Mapped[types.String] = mapped_column(String(50))
    # description:
    # address:
    # timezone:
    # dimensions:  list[(floor_id: string, width: float, depth: float, height: float), (...), ...]
    # visulizer: (grid_size, color, ..., svg_file: ?)
    # parents: list[organisation]
    # children: list[list[labs], list[zones]]    

class DBSite(Base):
    __tablename__ = "dm_sites"

    uuid: Mapped[types.Uuid] = mapped_column(types.Uuid, primary_key=True) 
    name: Mapped[types.String] = mapped_column(String(50)) type.
    description:
    address:
    timezone:
    dimensions:  list[(floor_id: string, width: float, depth: float, height: float), (...), ...]
    visulizer: (grid_size, color, ..., svg_file: ?)
    parents: list[organisation]
    children: list[list[labs], list[zones]]    
    

class Address(Base):
    __tablename__ = "address"
    id: Mapped[int] = mapped_column(primary_key=True)
    email_address: Mapped[str]
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    user: Mapped["User"] = relationship(back_populates="addresses")
    def __repr__(self) -> str:
        return f"Address(id={self.id!r}, email_address={self.email_address!r})"
    
    
with Session(engine) as session: