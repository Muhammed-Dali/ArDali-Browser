if(NOT DEFINED DALINIRA_ADULT_DOMAINS_OUTPUT OR
   NOT DEFINED DALINIRA_ADULT_DOMAINS_URL OR
   NOT DEFINED DALINIRA_ADULT_DOMAINS_SHA256)
  message(FATAL_ERROR "Adult domain source fetch parameters are incomplete")
endif()

get_filename_component(output_directory
  "${DALINIRA_ADULT_DOMAINS_OUTPUT}" DIRECTORY)
file(MAKE_DIRECTORY "${output_directory}")

if(EXISTS "${DALINIRA_ADULT_DOMAINS_OUTPUT}")
  file(SHA256 "${DALINIRA_ADULT_DOMAINS_OUTPUT}" existing_sha256)
  if(existing_sha256 STREQUAL DALINIRA_ADULT_DOMAINS_SHA256)
    message(STATUS "Adult Protection production source is present and verified")
    return()
  endif()
  message(STATUS "Adult Protection production source hash mismatch; fetching the pinned source")
endif()

set(temporary_output "${DALINIRA_ADULT_DOMAINS_OUTPUT}.download")
file(REMOVE "${temporary_output}")
file(DOWNLOAD
  "${DALINIRA_ADULT_DOMAINS_URL}"
  "${temporary_output}"
  EXPECTED_HASH "SHA256=${DALINIRA_ADULT_DOMAINS_SHA256}"
  TLS_VERIFY ON
  STATUS download_status
  SHOW_PROGRESS)
list(GET download_status 0 download_code)
list(GET download_status 1 download_message)
if(NOT download_code EQUAL 0)
  file(REMOVE "${temporary_output}")
  message(FATAL_ERROR
    "Could not obtain the pinned Adult Protection production source: ${download_message}")
endif()

file(REMOVE "${DALINIRA_ADULT_DOMAINS_OUTPUT}")
file(RENAME "${temporary_output}" "${DALINIRA_ADULT_DOMAINS_OUTPUT}")
file(SHA256 "${DALINIRA_ADULT_DOMAINS_OUTPUT}" downloaded_sha256)
if(NOT downloaded_sha256 STREQUAL DALINIRA_ADULT_DOMAINS_SHA256)
  file(REMOVE "${DALINIRA_ADULT_DOMAINS_OUTPUT}")
  message(FATAL_ERROR "Downloaded Adult Protection production source failed SHA-256 verification")
endif()

message(STATUS "Fetched and verified the pinned Adult Protection production source")
