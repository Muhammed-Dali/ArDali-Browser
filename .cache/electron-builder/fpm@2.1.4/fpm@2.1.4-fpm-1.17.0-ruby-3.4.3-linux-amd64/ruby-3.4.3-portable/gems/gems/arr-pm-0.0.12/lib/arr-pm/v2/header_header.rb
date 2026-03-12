# encoding: utf-8

require "arr-pm/namespace"
require "arr-pm/v2/format"
require "arr-pm/v2/error"

# The header of an rpm has ... a header. Funky naming :)
class ArrPM::V2::HeaderHeader
  MAGIC = [ 0x8e, 0xad, 0xe8 ]
  MAGIC_LENGTH = MAGIC.count

  attr_accessor :version, :entries, :bytesize

  def load(io)
    data = io.read(16)
    parse(data)
  end

  def parse(data)
    magic, version, reserved, entries, bytesize = data.unpack("a3Ca4NN")
    self.class.validate_magic(magic.bytes)

    @version = version
    @entries = entries
    @bytesize = bytesize
    nil
  end

  def dump
    [magic, 1, 0, @entries, @bytesize].pack("a3Ca4NN")
  end

  def self.validate_magic(value)
    raise ArrPM::V2::Error::InvalidHeaderMagicValue, value if value != MAGIC
  end
end
