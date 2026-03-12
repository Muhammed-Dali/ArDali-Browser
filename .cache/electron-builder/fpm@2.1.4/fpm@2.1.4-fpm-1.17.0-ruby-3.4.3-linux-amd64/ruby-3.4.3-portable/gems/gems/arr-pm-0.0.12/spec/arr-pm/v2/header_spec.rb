# encoding: utf-8

require "flores/random"

require "arr-pm/v2/header"
require "arr-pm/v2/type"
require "arr-pm/v2/architecture"
require "json"

describe ArrPM::V2::Header do
  context "with a known good rpm" do
    let(:path) { File.join(File.dirname(__FILE__), "../../fixtures/example-1.0-1.x86_64.rpm") }
    let(:file) { File.new(path) }

    before do
      lead = ArrPM::V2::Lead.new
      lead.load(file)

      # Throw away the signature if we have one
      described_class.new.load(file) if lead.signature?

      subject.load(file)
    end

    expectations = JSON.parse(File.read(File.join(File.dirname(__FILE__), "../../fixtures/example.json")))

    expectations.each do |name, expected_value|
      it "should have expected value for the #{name} tag" do
        tag = subject.tags.find { |t| t.tag.to_s == name }
        expect(tag.value).to be == expected_value
      end
    end
  end
end
