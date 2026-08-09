//! ELF and DWARF artifact provider.

use std::{borrow::Cow, fmt, rc::Rc};

use addr2line::gimli::{self, EndianRcSlice, RunTimeEndian};
use faultscope_core::SymbolProvider;
use faultscope_model::{SourceLocation, SymbolizedAddress, TargetAddress};
use object::{BinaryFormat, Object, ObjectSection, ObjectSymbol};

/// A validated ELF image used for symbol and source lookup.
pub struct ElfSymbolProvider {
    bytes: Vec<u8>,
}

#[derive(Debug)]
pub enum SymbolError {
    InvalidElf(String),
    UnsupportedFormat,
    Dwarf(String),
}

impl fmt::Display for SymbolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidElf(error) => write!(formatter, "invalid ELF: {error}"),
            Self::UnsupportedFormat => formatter.write_str("artifact is not an ELF file"),
            Self::Dwarf(error) => write!(formatter, "invalid DWARF: {error}"),
        }
    }
}

impl std::error::Error for SymbolError {}

impl ElfSymbolProvider {
    /// Validates and retains an ELF image.
    ///
    /// # Errors
    ///
    /// Returns an error when the bytes are not a valid ELF object.
    pub fn parse(bytes: Vec<u8>) -> Result<Self, SymbolError> {
        let file = object::File::parse(bytes.as_slice())
            .map_err(|error| SymbolError::InvalidElf(error.to_string()))?;
        if file.format() != BinaryFormat::Elf {
            return Err(SymbolError::UnsupportedFormat);
        }
        Ok(Self { bytes })
    }

    fn file(&self) -> Result<object::File<'_>, SymbolError> {
        object::File::parse(self.bytes.as_slice())
            .map_err(|error| SymbolError::InvalidElf(error.to_string()))
    }

    fn source_location(
        file: &object::File<'_>,
        address: u64,
    ) -> Result<Option<SourceLocation>, SymbolError> {
        let endian = if file.is_little_endian() {
            RunTimeEndian::Little
        } else {
            RunTimeEndian::Big
        };
        let dwarf = gimli::Dwarf::load(|section_id| {
            let data = match file.section_by_name(section_id.name()) {
                Some(section) => section.uncompressed_data()?,
                None => Cow::default(),
            };
            Ok::<_, object::Error>(EndianRcSlice::new(Rc::from(data.as_ref()), endian))
        })
        .map_err(|error| SymbolError::Dwarf(error.to_string()))?;
        let context = addr2line::Context::from_dwarf(dwarf)
            .map_err(|error| SymbolError::Dwarf(error.to_string()))?;
        let location = context
            .find_location(address)
            .map_err(|error| SymbolError::Dwarf(error.to_string()))?;

        Ok(location.and_then(|location| {
            let file = location.file?;
            let line = location.line?;
            Some(SourceLocation {
                file: file.to_owned(),
                line,
                column: location.column,
            })
        }))
    }
}

impl SymbolProvider for ElfSymbolProvider {
    type Error = SymbolError;

    fn resolve(&self, address: TargetAddress) -> Result<SymbolizedAddress, Self::Error> {
        let file = self.file()?;
        let symbol = file
            .symbols()
            .chain(file.dynamic_symbols())
            .filter(|symbol| {
                let start = symbol.address();
                let end = start.saturating_add(symbol.size());
                start <= address.value && address.value < end
            })
            .min_by_key(|symbol| address.value - symbol.address())
            .and_then(|symbol| symbol.name().ok())
            .map(str::to_owned);
        let source = Self::source_location(&file, address.value)?;

        Ok(SymbolizedAddress {
            address,
            symbol,
            source,
        })
    }
}
