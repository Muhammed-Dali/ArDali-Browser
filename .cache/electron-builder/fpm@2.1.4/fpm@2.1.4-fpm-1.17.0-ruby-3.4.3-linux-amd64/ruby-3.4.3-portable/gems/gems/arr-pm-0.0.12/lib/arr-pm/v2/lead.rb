# encoding: utf-8

require "arr-pm/namespace"
require "arr-pm/v2/format"
require "arr-pm/v2/error"

class ArrPM::V2::Lead
  LENGTH = 96
  MAGIC = [ 0xed, 0xab, 0xee, 0xdb ]
  MAGIC_LENGTH = MAGIC.count

  SIGNED_TYPE = 5
  
  attr_accessor :major, :minor, :type, :architecture, :name, :os, :signature_type, :reserved

  def validate
    self.class.validate_type(type)
    self.class.validate_architecture(architecture)
    if name.length > 65
      raise ArrPM::V2::Error::InvalidName, "Name is longer than 65 chracters. This is invalid."
    end
  end

  def dump(io)
    io.write(serialize)
  end

  def serialize
    validate
    [ *MAGIC, major, minor, type, architecture, name, os, signature_type, *reserved ].pack("C4CCnnZ66nnC16")
  end

  def load(io)
    data = io.read(LENGTH)
    parse(data)
  end

  def parse(bytestring)
    raise ArrPM::V2::Error::EmptyFile if bytestring.nil?
    data = bytestring.bytes

    @magic = self.class.parse_magic(data)
    @major, @minor = self.class.parse_version(data)
    @type = self.class.parse_type(data)
    @architecture = self.class.parse_architecture(data)
    @name = self.class.parse_name(data)
    @os = self.class.parse_os(data)
    @signature_type = self.class.parse_signature_type(data)
    @reserved = self.class.parse_reserved(data)
    self
  end
  
  def signature?
    @signature_type == SIGNED_TYPE
  end

  def self.valid_version?(version)
    version == 1
  end

  def self.parse_magic(data)
    magic = data[0, MAGIC_LENGTH]
    validate_magic(magic)
    magic
  end

  def self.validate_magic(magic)
    raise ArrPM::V2::Error::InvalidMagicValue, magic unless magic == MAGIC
  end

  def self.parse_version(data)
    offset = MAGIC_LENGTH
    major, minor = data[offset, 2]
    return major, minor
  end

  def self.parse_type(data)
    offset = MAGIC_LENGTH + 2
    type = data[offset, 2].pack("CC").unpack("n").first
    validate_type(type)
    type
  end

  def self.validate_type(type)
    raise ArrPM::V2::Error::InvalidType, type unless ArrPM::V2::Type.valid?(type)
  end

  def self.parse_architecture(data)
    offset = MAGIC_LENGTH + 4
    architecture = data[offset, 2].pack("C*").unpack("n").first
    validate_architecture(architecture)
    architecture
  end

  def self.validate_architecture(architecture)
    raise ArrPM::V2::Error::InvalidArchitecture unless ArrPM::V2::Architecture.valid?(architecture)
  end

  def self.parse_name(data)
    offset = MAGIC_LENGTH + 6
    name = data[offset, 66]
    length = name.find_index(0) # find the first null byte
    raise ArrPM::V2::Error::InvalidName unless length
    return name[0, length].pack("C*")
  end

  def self.parse_os(data)
    offset = MAGIC_LENGTH + 72
    data[offset, 2].pack("C*").unpack("n").first
  end

  def self.parse_signature_type(data)
    offset = MAGIC_LENGTH + 74
    data[offset, 2].pack("C*").unpack("n").first
  end

  def self.parse_reserved(data)
    offset = MAGIC_LENGTH + 76
    data[offset, 16]
  end
end
