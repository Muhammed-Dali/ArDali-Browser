# encoding: utf-8

require "arr-pm/namespace"
require "arr-pm/v2/format"
require "arr-pm/v2/header_header"
require "arr-pm/v2/tag"
require "arr-pm/v2/error"

class ArrPM::V2::Header
  attr_reader :tags

  def load(io)
    headerheader = ArrPM::V2::HeaderHeader.new
    headerheader.load(io)
    headerdata = io.read(headerheader.entries * 16)
    tagdata = io.read(headerheader.bytesize)
    parse(headerdata, headerheader.entries, tagdata)

    # signature headers are padded up to an 8-byte boundar, details here:
    # http://rpm.org/gitweb?p=rpm.git;a=blob;f=lib/signature.c;h=63e59c00f255a538e48cbc8b0cf3b9bd4a4dbd56;hb=HEAD#l204
    # Throw away the pad.
    io.read(tagdata.length % 8)
  end

  def parse(data, entry_count, tagdata)
    @tags = entry_count.times.collect do |i|
      tag_number, type_number, offset, count = data[i * 16, 16].unpack("NNNN")

      tag = ArrPM::V2::Tag.new(tag_number, type_number)
      tag.parse(tagdata, offset, count)
      tag
    end
    nil
  end
end
