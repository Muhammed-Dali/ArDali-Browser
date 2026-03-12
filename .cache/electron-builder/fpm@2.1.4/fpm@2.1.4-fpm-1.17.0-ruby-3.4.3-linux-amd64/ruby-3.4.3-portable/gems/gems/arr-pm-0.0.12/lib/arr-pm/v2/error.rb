# encoding: utf-8

require "arr-pm/namespace"
require "arr-pm/v2/format"

module ArrPM::V2::Error
  class Base < StandardError; end

  class InvalidMagicValue < Base
    def initialize(value)
      super("Got invalid magic value '#{value}'. Expected #{ArrPM::V2::Format::MAGIC}.")
    end
  end

  class InvalidHeaderMagicValue < Base
    def initialize(value)
      super("Got invalid magic value '#{value}'. Expected #{ArrPM::V2::HeaderHeader::MAGIC}.")
    end
  end

  class EmptyFile < Base; end
  class ShortFile < Base; end
  class InvalidVersion < Base; end
  class InvalidType < Base
    def initialize(value)
      super("Invalid type: #{value.inspect}")
    end
  end
  class InvalidName < Base; end
  class InvalidArchitecture < Base; end

end
