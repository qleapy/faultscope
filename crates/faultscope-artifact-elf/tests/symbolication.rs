use faultscope_artifact_elf::{ElfSymbolProvider, SymbolError};
use faultscope_core::SymbolProvider;
use faultscope_model::{AddressSpaceId, TargetAddress};
use gimli::{
    Encoding, Format, LineEncoding, LittleEndian,
    write::{Address, AttributeValue, Dwarf, EndianVec, LineProgram, LineString, Sections, Unit},
};
use object::{
    Architecture, BinaryFormat, Endianness, SectionKind,
    write::{Object, StandardSection, Symbol, SymbolSection},
};

fn target_address(value: u64) -> TargetAddress {
    TargetAddress {
        value,
        address_space: AddressSpaceId("virtual".to_owned()),
        role: None,
    }
}

fn elf(with_symbol: bool, with_dwarf: bool) -> Vec<u8> {
    let mut object = Object::new(BinaryFormat::Elf, Architecture::X86_64, Endianness::Little);
    let text = object.section_id(StandardSection::Text);
    let offset = object.append_section_data(text, &[0x90, 0x90, 0x90, 0xc3], 1);
    if with_symbol {
        object.add_symbol(Symbol {
            name: b"crash_here".to_vec(),
            value: offset,
            size: 4,
            kind: object::SymbolKind::Text,
            scope: object::SymbolScope::Linkage,
            weak: false,
            section: SymbolSection::Section(text),
            flags: object::SymbolFlags::None,
        });
    }

    if with_dwarf {
        let encoding = Encoding {
            format: Format::Dwarf32,
            version: 4,
            address_size: 8,
        };
        let mut program = LineProgram::new(
            encoding,
            LineEncoding::default(),
            LineString::String(b"/src".to_vec()),
            None,
            LineString::String(b"main.c".to_vec()),
            None,
        );
        let file = program.add_file(
            LineString::String(b"main.c".to_vec()),
            program.default_directory(),
            None,
        );
        program.begin_sequence(Some(Address::Constant(offset)));
        program.row().file = file;
        program.row().line = 42;
        program.row().column = 7;
        program.generate_row();
        program.end_sequence(4);

        let mut unit = Unit::new(encoding, program);
        unit.get_mut(unit.root())
            .set(gimli::DW_AT_stmt_list, AttributeValue::LineProgramRef);
        let mut dwarf = Dwarf::new();
        dwarf.units.add(unit);
        let mut sections = Sections::new(EndianVec::new(LittleEndian));
        dwarf.write(&mut sections).unwrap();
        sections
            .for_each(|id, data| {
                if !data.slice().is_empty() {
                    let section = object.add_section(
                        Vec::new(),
                        id.name().as_bytes().to_vec(),
                        SectionKind::Debug,
                    );
                    object.append_section_data(section, data.slice(), 1);
                }
                Ok::<_, ()>(())
            })
            .unwrap();
    }

    object.write().unwrap()
}

#[test]
fn resolves_elf_symbol_without_dwarf() {
    let provider = ElfSymbolProvider::parse(elf(true, false)).unwrap();
    let result = provider.resolve(target_address(0)).unwrap();
    assert_eq!(result.symbol.as_deref(), Some("crash_here"));
    assert_eq!(result.source, None);
}

#[test]
fn resolves_dwarf_source_location() {
    let provider = ElfSymbolProvider::parse(elf(true, true)).unwrap();
    let result = provider.resolve(target_address(0)).unwrap();
    let source = result.source.unwrap();
    assert!(source.file.ends_with("main.c"));
    assert_eq!(source.line, 42);
    assert_eq!(source.column, Some(7));
}

#[test]
fn accepts_stripped_elf() {
    let provider = ElfSymbolProvider::parse(elf(false, false)).unwrap();
    let result = provider.resolve(target_address(0)).unwrap();
    assert_eq!(result.symbol, None);
    assert_eq!(result.source, None);
}

#[test]
fn rejects_invalid_and_truncated_files() {
    assert!(matches!(
        ElfSymbolProvider::parse(b"not an object".to_vec()),
        Err(SymbolError::InvalidElf(_))
    ));
    let mut truncated = elf(true, true);
    truncated.truncate(20);
    assert!(matches!(
        ElfSymbolProvider::parse(truncated),
        Err(SymbolError::InvalidElf(_))
    ));
}

#[test]
fn rejects_non_elf_objects() {
    let object = Object::new(BinaryFormat::Coff, Architecture::X86_64, Endianness::Little)
        .write()
        .unwrap();
    assert!(matches!(
        ElfSymbolProvider::parse(object),
        Err(SymbolError::UnsupportedFormat)
    ));
}

#[test]
fn address_outside_image_is_not_an_error() {
    let provider = ElfSymbolProvider::parse(elf(true, true)).unwrap();
    let result = provider.resolve(target_address(0x1_0000)).unwrap();
    assert_eq!(result.symbol, None);
    assert_eq!(result.source, None);
}
