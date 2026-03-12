# encoding: utf-8

require "arr-pm/namespace"

module ArrPM::V2::Format
  MAGIC = [0x8e, 0xad, 0xe8]
  MAGIC_LENGTH = MAGIC.count
  MAGIC_STRING = MAGIC.pack("C#{MAGIC_LENGTH}")

  module_function
  def valid_magic?(magic)
    magic = magic.bytes if magic.is_a?(String)

    magic == MAGIC
  end
end
