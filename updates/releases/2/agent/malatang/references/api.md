# API reference

Application build: 2

## appearance.get

Read the saved application theme preference.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": [
        "system",
        "light",
        "dark"
      ]
    }
  },
  "required": [
    "theme"
  ],
  "additionalProperties": false
}
```

## appearance.set

Persist light, dark or system theme and apply it to native windows and plugin pages.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": [
        "system",
        "light",
        "dark"
      ]
    }
  },
  "required": [
    "theme"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": [
        "system",
        "light",
        "dark"
      ]
    }
  },
  "required": [
    "theme"
  ],
  "additionalProperties": false
}
```

## chatgpt.status

Read saved ChatGPT connection summaries without credentials.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.signIn

Start official ChatGPT OAuth in the system browser; returns promptly. Omit profileId only to register a new account.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    },
    "consent": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.cancel

Cancel an outstanding ChatGPT sign-in attempt.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.select

Select a saved ChatGPT registration for the settings picker; models retain their original account binding.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    }
  },
  "required": [
    "profileId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.rename

Rename a saved account without changing its identity or model bindings.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    },
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "profileId",
    "label"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.remove

Remove selected local registrations atomically. Requires signed-out accounts with no bound models or active login. Does not revoke remote registrations.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileIds": {
      "minItems": 1,
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "profileIds"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.signOut

Revoke the renewable session and clear local tokens, retaining the registration.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    }
  },
  "required": [
    "profileId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.acknowledge

Dismiss the first connected-plan welcome message.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    }
  },
  "required": [
    "profileId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "available": {
      "type": "boolean"
    },
    "activeProfileId": {
      "type": [
        "string",
        "null"
      ]
    },
    "profiles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "email": {
            "type": [
              "string",
              "null"
            ]
          },
          "connected": {
            "type": "boolean"
          },
          "sharing": {
            "type": "boolean"
          },
          "welcomeSeen": {
            "type": "boolean"
          },
          "incomplete": {
            "type": "boolean"
          },
          "removalBlockedReason": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "label",
          "email",
          "connected",
          "sharing",
          "welcomeSeen",
          "incomplete",
          "removalBlockedReason"
        ],
        "additionalProperties": false
      }
    },
    "attempt": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "id": {
              "type": "string"
            },
            "profileId": {
              "type": [
                "string",
                "null"
              ]
            },
            "stage": {
              "type": "string",
              "enum": [
                "waiting",
                "exchanging",
                "completed",
                "failed",
                "cancelled"
              ]
            },
            "message": {
              "type": "string"
            }
          },
          "required": [
            "id",
            "profileId",
            "stage",
            "message"
          ],
          "additionalProperties": false
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": "string"
    }
  },
  "required": [
    "available",
    "activeProfileId",
    "profiles",
    "attempt",
    "message"
  ],
  "additionalProperties": false
}
```

## chatgpt.catalog

Fetch the current account-specific ChatGPT model catalog using its OAuth token.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    }
  },
  "required": [
    "profileId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      }
    },
    "required": [
      "id",
      "name"
    ],
    "additionalProperties": false
  }
}
```

## chatgpt.addModel

Add a model available to the selected ChatGPT account. Does not generate text or switch billing paths.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profileId": {
      "type": "string"
    },
    "modelId": {
      "type": "string"
    }
  },
  "required": [
    "profileId",
    "modelId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "provider": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "baseURL": {
      "type": "string"
    },
    "kind": {
      "type": "string",
      "enum": [
        "openai-compatible",
        "pi",
        "chatgpt"
      ]
    },
    "configured": {
      "type": "boolean"
    },
    "preset": {
      "type": [
        "string",
        "null"
      ]
    },
    "hasApiKey": {
      "type": "boolean"
    },
    "chatgptProfileId": {
      "type": "string"
    },
    "options": {
      "type": "object",
      "propertyNames": {
        "type": "string",
        "maxLength": 60
      },
      "additionalProperties": {
        "type": "string",
        "maxLength": 300
      }
    }
  },
  "required": [
    "id",
    "name",
    "provider",
    "model",
    "baseURL",
    "kind",
    "configured",
    "preset",
    "hasApiKey",
    "options"
  ],
  "additionalProperties": false
}
```

## chatgpt.manageUsage

Open ChatGPT Settings Usage in the system browser.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "null"
}
```

## models.list

List host-configured models. Credentials are never returned.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "provider": {
        "type": "string"
      },
      "model": {
        "type": "string"
      },
      "baseURL": {
        "type": "string"
      },
      "kind": {
        "type": "string",
        "enum": [
          "openai-compatible",
          "pi",
          "chatgpt"
        ]
      },
      "configured": {
        "type": "boolean"
      },
      "preset": {
        "type": [
          "string",
          "null"
        ]
      },
      "hasApiKey": {
        "type": "boolean"
      },
      "chatgptProfileId": {
        "type": "string"
      },
      "options": {
        "type": "object",
        "propertyNames": {
          "type": "string",
          "maxLength": 60
        },
        "additionalProperties": {
          "type": "string",
          "maxLength": 300
        }
      }
    },
    "required": [
      "id",
      "name",
      "provider",
      "model",
      "baseURL",
      "kind",
      "configured",
      "preset",
      "hasApiKey",
      "options"
    ],
    "additionalProperties": false
  }
}
```

## models.providers

List all Pi provider presets and their configuration requirements.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "modelCount": {
        "type": "number"
      },
      "apiKeySupported": {
        "type": "boolean"
      },
      "keyLabel": {
        "type": "string"
      },
      "notice": {
        "type": "string"
      },
      "fields": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "key": {
              "type": "string"
            },
            "label": {
              "type": "string"
            },
            "placeholder": {
              "type": "string"
            },
            "required": {
              "type": "boolean"
            }
          },
          "required": [
            "key",
            "label",
            "placeholder",
            "required"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "id",
      "name",
      "modelCount",
      "apiKeySupported",
      "keyLabel",
      "notice",
      "fields"
    ],
    "additionalProperties": false
  }
}
```

## models.catalog

Read the bundled Pi chat model catalog for one provider.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "providerId": {
      "type": "string"
    }
  },
  "required": [
    "providerId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "api": {
        "type": "string"
      },
      "baseURL": {
        "type": "string"
      },
      "contextWindow": {
        "type": "number"
      },
      "reasoning": {
        "type": "boolean"
      }
    },
    "required": [
      "id",
      "name",
      "api",
      "baseURL",
      "contextWindow",
      "reasoning"
    ],
    "additionalProperties": false
  }
}
```

## models.save

Save a Pi preset or custom OpenAI-compatible model. Omitted keys are retained only when provider and endpoint are unchanged.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "provider": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "model": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "baseURL": {
      "type": "string",
      "maxLength": 2000
    },
    "apiKey": {
      "type": "string",
      "maxLength": 2000
    },
    "clearApiKey": {
      "type": "boolean"
    },
    "preset": {
      "type": [
        "string",
        "null"
      ]
    },
    "options": {
      "type": "object",
      "propertyNames": {
        "type": "string",
        "maxLength": 60
      },
      "additionalProperties": {
        "type": "string",
        "maxLength": 300
      }
    }
  },
  "required": [
    "name",
    "provider",
    "model",
    "baseURL"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "provider": {
      "type": "string"
    },
    "model": {
      "type": "string"
    },
    "baseURL": {
      "type": "string"
    },
    "kind": {
      "type": "string",
      "enum": [
        "openai-compatible",
        "pi",
        "chatgpt"
      ]
    },
    "configured": {
      "type": "boolean"
    },
    "preset": {
      "type": [
        "string",
        "null"
      ]
    },
    "hasApiKey": {
      "type": "boolean"
    },
    "chatgptProfileId": {
      "type": "string"
    },
    "options": {
      "type": "object",
      "propertyNames": {
        "type": "string",
        "maxLength": 60
      },
      "additionalProperties": {
        "type": "string",
        "maxLength": 300
      }
    }
  },
  "required": [
    "id",
    "name",
    "provider",
    "model",
    "baseURL",
    "kind",
    "configured",
    "preset",
    "hasApiKey",
    "options"
  ],
  "additionalProperties": false
}
```

## models.remove

Remove a configured model; active calls prevent removal.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "null"
}
```

## models.generate

Start a background text generation. Poll runs.get or subscribe to runs.changed.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "modelId": {
      "type": "string"
    },
    "prompt": {
      "type": "string",
      "minLength": 1,
      "maxLength": 16000
    },
    "system": {
      "type": "string",
      "maxLength": 16000
    },
    "title": {
      "type": "string",
      "maxLength": 100
    }
  },
  "required": [
    "pluginId",
    "modelId",
    "prompt"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "pluginId": {
      "type": "string"
    },
    "modelId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "input": {
      "type": "string"
    },
    "output": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "running",
        "completed",
        "cancelled",
        "failed"
      ]
    },
    "error": {
      "type": [
        "string",
        "null"
      ]
    },
    "createdAt": {
      "type": "number"
    },
    "updatedAt": {
      "type": "number"
    },
    "revision": {
      "type": "number"
    },
    "demo": {
      "type": "boolean"
    }
  },
  "required": [
    "id",
    "pluginId",
    "modelId",
    "title",
    "input",
    "output",
    "status",
    "error",
    "createdAt",
    "updatedAt",
    "revision",
    "demo"
  ],
  "additionalProperties": false
}
```

## runs.list

Read the latest 30 run summaries (input/output truncated to 300 characters). Use runs.get for full content.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "pluginId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "pluginId": {
        "type": "string"
      },
      "modelId": {
        "type": "string"
      },
      "title": {
        "type": "string"
      },
      "input": {
        "type": "string"
      },
      "output": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "running",
          "completed",
          "cancelled",
          "failed"
        ]
      },
      "error": {
        "type": [
          "string",
          "null"
        ]
      },
      "createdAt": {
        "type": "number"
      },
      "updatedAt": {
        "type": "number"
      },
      "revision": {
        "type": "number"
      },
      "demo": {
        "type": "boolean"
      }
    },
    "required": [
      "id",
      "pluginId",
      "modelId",
      "title",
      "input",
      "output",
      "status",
      "error",
      "createdAt",
      "updatedAt",
      "revision",
      "demo"
    ],
    "additionalProperties": false
  }
}
```

## runs.get

Read the authoritative state of a plugin run, also after event reconnection.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "runId": {
      "type": "string"
    }
  },
  "required": [
    "pluginId",
    "runId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "pluginId": {
      "type": "string"
    },
    "modelId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "input": {
      "type": "string"
    },
    "output": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "running",
        "completed",
        "cancelled",
        "failed"
      ]
    },
    "error": {
      "type": [
        "string",
        "null"
      ]
    },
    "createdAt": {
      "type": "number"
    },
    "updatedAt": {
      "type": "number"
    },
    "revision": {
      "type": "number"
    },
    "demo": {
      "type": "boolean"
    }
  },
  "required": [
    "id",
    "pluginId",
    "modelId",
    "title",
    "input",
    "output",
    "status",
    "error",
    "createdAt",
    "updatedAt",
    "revision",
    "demo"
  ],
  "additionalProperties": false
}
```

## runs.cancel

Cancel an active run and wait until its terminal state is saved.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "runId": {
      "type": "string"
    }
  },
  "required": [
    "pluginId",
    "runId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "pluginId": {
      "type": "string"
    },
    "modelId": {
      "type": "string"
    },
    "title": {
      "type": "string"
    },
    "input": {
      "type": "string"
    },
    "output": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "running",
        "completed",
        "cancelled",
        "failed"
      ]
    },
    "error": {
      "type": [
        "string",
        "null"
      ]
    },
    "createdAt": {
      "type": "number"
    },
    "updatedAt": {
      "type": "number"
    },
    "revision": {
      "type": "number"
    },
    "demo": {
      "type": "boolean"
    }
  },
  "required": [
    "id",
    "pluginId",
    "modelId",
    "title",
    "input",
    "output",
    "status",
    "error",
    "createdAt",
    "updatedAt",
    "revision",
    "demo"
  ],
  "additionalProperties": false
}
```

## plugins.list

List installed and built-in applications and their activation state.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "description": {
        "type": "string"
      },
      "icon": {
        "type": "string"
      },
      "color": {
        "type": "string"
      },
      "version": {
        "type": "string"
      },
      "packageName": {
        "type": "string"
      },
      "source": {
        "type": "string"
      },
      "builtin": {
        "type": "boolean"
      },
      "enabled": {
        "type": "boolean"
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "disabled",
          "error"
        ]
      },
      "error": {
        "type": [
          "string",
          "null"
        ]
      },
      "clientURL": {
        "type": "string"
      },
      "styleURL": {
        "type": [
          "string",
          "null"
        ]
      },
      "keepAlive": {
        "type": "boolean"
      },
      "methods": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "description": {
              "type": "string"
            },
            "inputSchema": {
              "$ref": "#/$defs/__schema0"
            }
          },
          "required": [
            "name",
            "description",
            "inputSchema"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "id",
      "name",
      "description",
      "icon",
      "color",
      "version",
      "packageName",
      "source",
      "builtin",
      "enabled",
      "status",
      "error",
      "clientURL",
      "styleURL",
      "keepAlive",
      "methods"
    ],
    "additionalProperties": false
  },
  "$defs": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/$defs/__schema0"
          }
        }
      ]
    }
  }
}
```

## plugins.invoke

Call a plugin method. Discover method names and input schemas with plugins.list.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "method": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "input": {
      "$ref": "#/$defs/__schema0"
    }
  },
  "required": [
    "pluginId",
    "method",
    "input"
  ],
  "additionalProperties": false,
  "$defs": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/$defs/__schema0"
          }
        }
      ]
    }
  }
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "anyOf": [
    {
      "type": "string"
    },
    {
      "type": "number"
    },
    {
      "type": "boolean"
    },
    {
      "type": "null"
    },
    {
      "type": "array",
      "items": {
        "$ref": "#"
      }
    },
    {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {
        "$ref": "#"
      }
    }
  ]
}
```

## plugins.install

Install a trusted, prebuilt plugin from an npm spec, Git URL or absolute local .tgz path. Returns an installation job.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    }
  },
  "required": [
    "source"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "source": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "installing",
        "completed",
        "failed"
      ]
    },
    "message": {
      "type": "string"
    },
    "pluginId": {
      "type": [
        "string",
        "null"
      ]
    },
    "createdAt": {
      "type": "number"
    }
  },
  "required": [
    "id",
    "source",
    "status",
    "message",
    "pluginId",
    "createdAt"
  ],
  "additionalProperties": false
}
```

## plugins.installExample

Install the included independently packed Quick Notes example.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "source": {
      "type": "string"
    },
    "status": {
      "type": "string",
      "enum": [
        "installing",
        "completed",
        "failed"
      ]
    },
    "message": {
      "type": "string"
    },
    "pluginId": {
      "type": [
        "string",
        "null"
      ]
    },
    "createdAt": {
      "type": "number"
    }
  },
  "required": [
    "id",
    "source",
    "status",
    "message",
    "pluginId",
    "createdAt"
  ],
  "additionalProperties": false
}
```

## plugins.jobs

Read recent installation job outcomes and progress.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "source": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "installing",
          "completed",
          "failed"
        ]
      },
      "message": {
        "type": "string"
      },
      "pluginId": {
        "type": [
          "string",
          "null"
        ]
      },
      "createdAt": {
        "type": "number"
      }
    },
    "required": [
      "id",
      "source",
      "status",
      "message",
      "pluginId",
      "createdAt"
    ],
    "additionalProperties": false
  }
}
```

## plugins.setEnabled

Enable or disable a plugin. Active runs must finish or be cancelled first.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "enabled": {
      "type": "boolean"
    }
  },
  "required": [
    "pluginId",
    "enabled"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "icon": {
      "type": "string"
    },
    "color": {
      "type": "string"
    },
    "version": {
      "type": "string"
    },
    "packageName": {
      "type": "string"
    },
    "source": {
      "type": "string"
    },
    "builtin": {
      "type": "boolean"
    },
    "enabled": {
      "type": "boolean"
    },
    "status": {
      "type": "string",
      "enum": [
        "active",
        "disabled",
        "error"
      ]
    },
    "error": {
      "type": [
        "string",
        "null"
      ]
    },
    "clientURL": {
      "type": "string"
    },
    "styleURL": {
      "type": [
        "string",
        "null"
      ]
    },
    "keepAlive": {
      "type": "boolean"
    },
    "methods": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "inputSchema": {
            "$ref": "#/$defs/__schema0"
          }
        },
        "required": [
          "name",
          "description",
          "inputSchema"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "id",
    "name",
    "description",
    "icon",
    "color",
    "version",
    "packageName",
    "source",
    "builtin",
    "enabled",
    "status",
    "error",
    "clientURL",
    "styleURL",
    "keepAlive",
    "methods"
  ],
  "additionalProperties": false,
  "$defs": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/$defs/__schema0"
          }
        }
      ]
    }
  }
}
```

## plugins.uninstall

Remove an external plugin and its managed package files. KV and run history are retained.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "pluginId"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "null"
}
```

## kv.get

Read a plugin-scoped JSON value; absent keys return null.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "required": [
    "pluginId",
    "key"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "anyOf": [
    {
      "type": "string"
    },
    {
      "type": "number"
    },
    {
      "type": "boolean"
    },
    {
      "type": "null"
    },
    {
      "type": "array",
      "items": {
        "$ref": "#"
      }
    },
    {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {
        "$ref": "#"
      }
    }
  ]
}
```

## kv.set

Persist a plugin-scoped JSON value (maximum 64 KiB).

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "value": {
      "$ref": "#/$defs/__schema0"
    }
  },
  "required": [
    "pluginId",
    "key",
    "value"
  ],
  "additionalProperties": false,
  "$defs": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/$defs/__schema0"
          }
        }
      ]
    }
  }
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "null"
}
```

## kv.delete

Delete a plugin-scoped key.

Input:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "key": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    }
  },
  "required": [
    "pluginId",
    "key"
  ],
  "additionalProperties": false
}
```
Output:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "null"
}
```

## Event: appearance.changed

Theme preference changed. Reread appearance.get on reconnect.
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": [
        "system",
        "light",
        "dark"
      ]
    }
  },
  "required": [
    "theme"
  ],
  "additionalProperties": false
}
```

## Event: runs.changed

A run changed. Read its current snapshot; notifications have no replay.
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string"
    },
    "runId": {
      "type": "string"
    },
    "revision": {
      "type": "number"
    },
    "status": {
      "type": "string",
      "enum": [
        "running",
        "completed",
        "cancelled",
        "failed"
      ]
    }
  },
  "required": [
    "pluginId",
    "runId",
    "revision",
    "status"
  ],
  "additionalProperties": false
}
```

## Event: plugins.changed

Plugin registry or installation jobs changed. Reread their current state.
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "revision": {
      "type": "number"
    }
  },
  "required": [
    "revision"
  ],
  "additionalProperties": false
}
```

## Event: chatgpt.changed

ChatGPT connection or login changed. Reread chatgpt.status.
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "revision": {
      "type": "number"
    }
  },
  "required": [
    "revision"
  ],
  "additionalProperties": false
}
```

## Event: models.changed

Host model configurations changed.
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "revision": {
      "type": "number"
    }
  },
  "required": [
    "revision"
  ],
  "additionalProperties": false
}
```
