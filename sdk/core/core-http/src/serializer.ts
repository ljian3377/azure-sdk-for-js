// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
/* eslint-disable eqeqeq */

import * as base64 from "./util/base64";
import * as utils from "./util/utils";

export class Serializer {
  constructor(
    public readonly modelMappers: { [key: string]: any } = {},
    public readonly isXML?: boolean
  ) {}

  validateConstraints(mapper: Mapper, value: any, objectName: string): void {
    const failValidation = (
      constraintName: keyof MapperConstraints,
      constraintValue: any
    ): Error => {
      throw new Error(
        `"${objectName}" with value "${value}" should satisfy the constraint "${constraintName}": ${constraintValue}.`
      );
    };
    if (mapper.constraints && value != undefined) {
      const {
        ExclusiveMaximum,
        ExclusiveMinimum,
        InclusiveMaximum,
        InclusiveMinimum,
        MaxItems,
        MaxLength,
        MinItems,
        MinLength,
        MultipleOf,
        Pattern,
        UniqueItems
      } = mapper.constraints;
      if (ExclusiveMaximum != undefined && value >= ExclusiveMaximum) {
        failValidation("ExclusiveMaximum", ExclusiveMaximum);
      }
      if (ExclusiveMinimum != undefined && value <= ExclusiveMinimum) {
        failValidation("ExclusiveMinimum", ExclusiveMinimum);
      }
      if (InclusiveMaximum != undefined && value > InclusiveMaximum) {
        failValidation("InclusiveMaximum", InclusiveMaximum);
      }
      if (InclusiveMinimum != undefined && value < InclusiveMinimum) {
        failValidation("InclusiveMinimum", InclusiveMinimum);
      }
      if (MaxItems != undefined && value.length > MaxItems) {
        failValidation("MaxItems", MaxItems);
      }
      if (MaxLength != undefined && value.length > MaxLength) {
        failValidation("MaxLength", MaxLength);
      }
      if (MinItems != undefined && value.length < MinItems) {
        failValidation("MinItems", MinItems);
      }
      if (MinLength != undefined && value.length < MinLength) {
        failValidation("MinLength", MinLength);
      }
      if (MultipleOf != undefined && value % MultipleOf !== 0) {
        failValidation("MultipleOf", MultipleOf);
      }
      if (Pattern) {
        const pattern: RegExp = typeof Pattern === "string" ? new RegExp(Pattern) : Pattern;
        if (typeof value !== "string" || value.match(pattern) === null) {
          failValidation("Pattern", Pattern);
        }
      }
      if (
        UniqueItems &&
        value.some((item: any, i: number, ar: Array<any>) => ar.indexOf(item) !== i)
      ) {
        failValidation("UniqueItems", UniqueItems);
      }
    }
  }

  /**
   * Serialize the given object based on its metadata defined in the mapper
   *
   * @param {Mapper} mapper The mapper which defines the metadata of the serializable object
   *
   * @param {object|string|Array|number|boolean|Date|stream} object A valid Javascript object to be serialized
   *
   * @param {string} objectName Name of the serialized object
   *
   * @returns {object|string|Array|number|boolean|Date|stream} A valid serialized Javascript object
   */
  serialize(mapper: Mapper, object: any, objectName?: string): any {
    let payload: any = {};
    const mapperType = mapper.type.name as string;
    if (!objectName) {
      objectName = mapper.serializedName!;
    }
    if (mapperType.match(/^Sequence$/i) !== null) {
      payload = [];
    }

    if (mapper.isConstant) {
      object = mapper.defaultValue;
    }

    // This table of allowed values should help explain
    // the mapper.required and mapper.nullable properties.
    // X means "neither undefined or null are allowed".
    //           || required
    //           || true      | false
    //  nullable || ==========================
    //      true || null      | undefined/null
    //     false || X         | undefined
    // undefined || X         | undefined/null

    const { required, nullable } = mapper;

    if (required && nullable && object === undefined) {
      throw new Error(`${objectName} cannot be undefined.`);
    }
    if (required && !nullable && object == undefined) {
      throw new Error(`${objectName} cannot be null or undefined.`);
    }
    if (!required && nullable === false && object === null) {
      throw new Error(`${objectName} cannot be null.`);
    }

    if (object == undefined) {
      payload = object;
    } else {
      // Validate Constraints if any
      this.validateConstraints(mapper, object, objectName);
      if (mapperType.match(/^any$/i) !== null) {
        payload = object;
      } else if (mapperType.match(/^(Number|String|Boolean|Object|Stream|Uuid)$/i) !== null) {
        payload = serializeBasicTypes(mapperType, objectName, object);
      } else if (mapperType.match(/^Enum$/i) !== null) {
        const enumMapper: EnumMapper = mapper as EnumMapper;
        payload = serializeEnumType(objectName, enumMapper.type.allowedValues, object);
      } else if (
        mapperType.match(/^(Date|DateTime|TimeSpan|DateTimeRfc1123|UnixTime)$/i) !== null
      ) {
        payload = serializeDateTypes(mapperType, object, objectName);
      } else if (mapperType.match(/^ByteArray$/i) !== null) {
        payload = serializeByteArrayType(objectName, object);
      } else if (mapperType.match(/^Base64Url$/i) !== null) {
        payload = serializeBase64UrlType(objectName, object);
      } else if (mapperType.match(/^Sequence$/i) !== null) {
        payload = serializeSequenceType(
          this,
          mapper as SequenceMapper,
          object,
          objectName,
          Boolean(this.isXML)
        );
      } else if (mapperType.match(/^Dictionary$/i) !== null) {
        payload = serializeDictionaryType(
          this,
          mapper as DictionaryMapper,
          object,
          objectName,
          Boolean(this.isXML)
        );
      } else if (mapperType.match(/^Composite$/i) !== null) {
        payload = serializeCompositeType(
          this,
          mapper as CompositeMapper,
          object,
          objectName,
          Boolean(this.isXML)
        );
      }
    }
    return payload;
  }

  /**
   * Deserialize the given object based on its metadata defined in the mapper
   *
   * @param {object} mapper The mapper which defines the metadata of the serializable object
   *
   * @param {object|string|Array|number|boolean|Date|stream} responseBody A valid Javascript entity to be deserialized
   *
   * @param {string} objectName Name of the deserialized object
   *
   * @returns {object|string|Array|number|boolean|Date|stream} A valid deserialized Javascript object
   */
  deserialize(mapper: Mapper, responseBody: any, objectName: string): any {
    if (responseBody == undefined) {
      if (this.isXML && mapper.type.name === "Sequence" && !mapper.xmlIsWrapped) {
        // Edge case for empty XML non-wrapped lists. xml2js can't distinguish
        // between the list being empty versus being missing,
        // so let's do the more user-friendly thing and return an empty list.
        responseBody = [];
      }
      // specifically check for undefined as default value can be a falsey value `0, "", false, null`
      if (mapper.defaultValue !== undefined) {
        responseBody = mapper.defaultValue;
      }
      return responseBody;
    }

    let payload: any;
    const mapperType = mapper.type.name;
    if (!objectName) {
      objectName = mapper.serializedName!;
    }

    if (mapperType.match(/^Composite$/i) !== null) {
      payload = deserializeCompositeType(this, mapper as CompositeMapper, responseBody, objectName);
    } else {
      if (this.isXML) {
        /**
         * If the mapper specifies this as a non-composite type value but the responseBody contains
         * both header ("$") and body ("_") properties, then just reduce the responseBody value to
         * the body ("_") property.
         */
        if (responseBody["$"] != undefined && responseBody["_"] != undefined) {
          responseBody = responseBody["_"];
        }
      }

      if (mapperType.match(/^Number$/i) !== null) {
        payload = parseFloat(responseBody);
        if (isNaN(payload)) {
          payload = responseBody;
        }
      } else if (mapperType.match(/^Boolean$/i) !== null) {
        if (responseBody === "true") {
          payload = true;
        } else if (responseBody === "false") {
          payload = false;
        } else {
          payload = responseBody;
        }
      } else if (mapperType.match(/^(String|Enum|Object|Stream|Uuid|TimeSpan|any)$/i) !== null) {
        payload = responseBody;
      } else if (mapperType.match(/^(Date|DateTime|DateTimeRfc1123)$/i) !== null) {
        payload = new Date(responseBody);
      } else if (mapperType.match(/^UnixTime$/i) !== null) {
        payload = unixTimeToDate(responseBody);
      } else if (mapperType.match(/^ByteArray$/i) !== null) {
        payload = base64.decodeString(responseBody);
      } else if (mapperType.match(/^Base64Url$/i) !== null) {
        payload = base64UrlToByteArray(responseBody);
      } else if (mapperType.match(/^Sequence$/i) !== null) {
        payload = deserializeSequenceType(this, mapper as SequenceMapper, responseBody, objectName);
      } else if (mapperType.match(/^Dictionary$/i) !== null) {
        payload = deserializeDictionaryType(
          this,
          mapper as DictionaryMapper,
          responseBody,
          objectName
        );
      }
    }

    if (mapper.isConstant) {
      payload = mapper.defaultValue;
    }

    return payload;
  }
}

function trimEnd(str: string, ch: string): string {
  let len = str.length;
  while (len - 1 >= 0 && str[len - 1] === ch) {
    --len;
  }
  return str.substr(0, len);
}

function bufferToBase64Url(buffer: any): string | undefined {
  if (!buffer) {
    return undefined;
  }
  if (!(buffer instanceof Uint8Array)) {
    throw new Error(`Please provide an input of type Uint8Array for converting to Base64Url.`);
  }
  // Uint8Array to Base64.
  const str = base64.encodeByteArray(buffer);
  // Base64 to Base64Url.
  return trimEnd(str, "=")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlToByteArray(str: string): Uint8Array | undefined {
  if (!str) {
    return undefined;
  }
  if (str && typeof str.valueOf() !== "string") {
    throw new Error("Please provide an input of type string for converting to Uint8Array");
  }
  // Base64Url to Base64.
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  // Base64 to Uint8Array.
  return base64.decodeString(str);
}

function splitSerializeName(prop: string | undefined): string[] {
  const classes: string[] = [];
  let partialclass = "";
  if (prop) {
    const subwords = prop.split(".");

    for (const item of subwords) {
      if (item.charAt(item.length - 1) === "\\") {
        partialclass += item.substr(0, item.length - 1) + ".";
      } else {
        partialclass += item;
        classes.push(partialclass);
        partialclass = "";
      }
    }
  }

  return classes;
}

function dateToUnixTime(d: string | Date): number | undefined {
  if (!d) {
    return undefined;
  }

  if (typeof d.valueOf() === "string") {
    d = new Date(d as string);
  }
  return Math.floor((d as Date).getTime() / 1000);
}

function unixTimeToDate(n: number): Date | undefined {
  if (!n) {
    return undefined;
  }
  return new Date(n * 1000);
}

function serializeBasicTypes(typeName: string, objectName: string, value: any): any {
  if (value !== null && value !== undefined) {
    if (typeName.match(/^Number$/i) !== null) {
      if (typeof value !== "number") {
        throw new Error(`${objectName} with value ${value} must be of type number.`);
      }
    } else if (typeName.match(/^String$/i) !== null) {
      if (typeof value.valueOf() !== "string") {
        throw new Error(`${objectName} with value "${value}" must be of type string.`);
      }
    } else if (typeName.match(/^Uuid$/i) !== null) {
      if (!(typeof value.valueOf() === "string" && utils.isValidUuid(value))) {
        throw new Error(
          `${objectName} with value "${value}" must be of type string and a valid uuid.`
        );
      }
    } else if (typeName.match(/^Boolean$/i) !== null) {
      if (typeof value !== "boolean") {
        throw new Error(`${objectName} with value ${value} must be of type boolean.`);
      }
    } else if (typeName.match(/^Stream$/i) !== null) {
      const objectType = typeof value;
      if (
        objectType !== "string" &&
        objectType !== "function" &&
        !(value instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(value) &&
        !(typeof Blob === "function" && value instanceof Blob)
      ) {
        throw new Error(
          `${objectName} must be a string, Blob, ArrayBuffer, ArrayBufferView, or a function returning NodeJS.ReadableStream.`
        );
      }
    }
  }

  return value;
}

function serializeEnumType(objectName: string, allowedValues: Array<any>, value: any): any {
  if (!allowedValues) {
    throw new Error(
      `Please provide a set of allowedValues to validate ${objectName} as an Enum Type.`
    );
  }
  const isPresent = allowedValues.some((item) => {
    if (typeof item.valueOf() === "string") {
      return item.toLowerCase() === value.toLowerCase();
    }
    return item === value;
  });
  if (!isPresent) {
    throw new Error(
      `${value} is not a valid value for ${objectName}. The valid values are: ${JSON.stringify(
        allowedValues
      )}.`
    );
  }
  return value;
}

function serializeByteArrayType(objectName: string, value: Uint8Array): string {
  let returnValue: string = "";
  if (value != undefined) {
    if (!(value instanceof Uint8Array)) {
      throw new Error(`${objectName} must be of type Uint8Array.`);
    }
    returnValue = base64.encodeByteArray(value);
  }
  return returnValue;
}

function serializeBase64UrlType(objectName: string, value: Uint8Array): string {
  let returnValue: string = "";
  if (value != undefined) {
    if (!(value instanceof Uint8Array)) {
      throw new Error(`${objectName} must be of type Uint8Array.`);
    }
    returnValue = bufferToBase64Url(value) || "";
  }
  return returnValue;
}

function serializeDateTypes(typeName: string, value: any, objectName: string): any {
  if (value != undefined) {
    if (typeName.match(/^Date$/i) !== null) {
      if (
        !(
          value instanceof Date ||
          (typeof value.valueOf() === "string" && !isNaN(Date.parse(value)))
        )
      ) {
        throw new Error(`${objectName} must be an instanceof Date or a string in ISO8601 format.`);
      }
      value =
        value instanceof Date
          ? value.toISOString().substring(0, 10)
          : new Date(value).toISOString().substring(0, 10);
    } else if (typeName.match(/^DateTime$/i) !== null) {
      if (
        !(
          value instanceof Date ||
          (typeof value.valueOf() === "string" && !isNaN(Date.parse(value)))
        )
      ) {
        throw new Error(`${objectName} must be an instanceof Date or a string in ISO8601 format.`);
      }
      value = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    } else if (typeName.match(/^DateTimeRfc1123$/i) !== null) {
      if (
        !(
          value instanceof Date ||
          (typeof value.valueOf() === "string" && !isNaN(Date.parse(value)))
        )
      ) {
        throw new Error(`${objectName} must be an instanceof Date or a string in RFC-1123 format.`);
      }
      value = value instanceof Date ? value.toUTCString() : new Date(value).toUTCString();
    } else if (typeName.match(/^UnixTime$/i) !== null) {
      if (
        !(
          value instanceof Date ||
          (typeof value.valueOf() === "string" && !isNaN(Date.parse(value)))
        )
      ) {
        throw new Error(
          `${objectName} must be an instanceof Date or a string in RFC-1123/ISO8601 format ` +
            `for it to be serialized in UnixTime/Epoch format.`
        );
      }
      value = dateToUnixTime(value);
    } else if (typeName.match(/^TimeSpan$/i) !== null) {
      if (!utils.isDuration(value)) {
        throw new Error(
          `${objectName} must be a string in ISO 8601 format. Instead was "${value}".`
        );
      }
    }
  }
  return value;
}

function serializeSequenceType(
  serializer: Serializer,
  mapper: SequenceMapper,
  object: any,
  objectName: string,
  isXml: boolean
): any[] {
  if (!Array.isArray(object)) {
    throw new Error(`${objectName} must be of type Array.`);
  }
  const elementType = mapper.type.element;
  if (!elementType || typeof elementType !== "object") {
    throw new Error(
      `element" metadata for an Array must be defined in the ` +
        `mapper and it must of type "object" in ${objectName}.`
    );
  }
  const tempArray = [];
  for (let i = 0; i < object.length; i++) {
    const serializedValue = serializer.serialize(elementType, object[i], objectName);

    if (isXml && elementType.xmlNamespace) {
      const xmlnsKey = elementType.xmlNamespacePrefix
        ? `xmlns:${elementType.xmlNamespacePrefix}`
        : "xmlns";
      if (elementType.type.name === "Composite") {
        tempArray[i] = { ...serializedValue, $: { [xmlnsKey]: elementType.xmlNamespace } };
      } else {
        tempArray[i] = { _: serializedValue, $: { [xmlnsKey]: elementType.xmlNamespace } };
      }
    } else {
      tempArray[i] = serializedValue;
    }
  }
  return tempArray;
}

function serializeDictionaryType(
  serializer: Serializer,
  mapper: DictionaryMapper,
  object: any,
  objectName: string,
  isXml: boolean
): { [key: string]: any } {
  if (typeof object !== "object") {
    throw new Error(`${objectName} must be of type object.`);
  }
  const valueType = mapper.type.value;
  if (!valueType || typeof valueType !== "object") {
    throw new Error(
      `"value" metadata for a Dictionary must be defined in the ` +
        `mapper and it must of type "object" in ${objectName}.`
    );
  }
  const tempDictionary: { [key: string]: any } = {};
  for (const key of Object.keys(object)) {
    const serializedValue = serializer.serialize(valueType, object[key], objectName);
    // If the element needs an XML namespace we need to add it within the $ property
    tempDictionary[key] = getXmlObjectValue(valueType, serializedValue, isXml);
  }

  // Add the namespace to the root element if needed
  if (isXml && mapper.xmlNamespace) {
    const xmlnsKey = mapper.xmlNamespacePrefix ? `xmlns:${mapper.xmlNamespacePrefix}` : "xmlns";

    return { ...tempDictionary, $: { [xmlnsKey]: mapper.xmlNamespace } };
  }

  return tempDictionary;
}

/**
 * Resolves a composite mapper's modelProperties.
 * @param serializer the serializer containing the entire set of mappers
 * @param mapper the composite mapper to resolve
 */
function resolveModelProperties(
  serializer: Serializer,
  mapper: CompositeMapper,
  objectName: string
): { [propertyName: string]: Mapper } {
  let modelProps = mapper.type.modelProperties;
  if (!modelProps) {
    const className = mapper.type.className;
    if (!className) {
      throw new Error(
        `Class name for model "${objectName}" is not provided in the mapper "${JSON.stringify(
          mapper,
          undefined,
          2
        )}".`
      );
    }

    const modelMapper = serializer.modelMappers[className];
    if (!modelMapper) {
      throw new Error(`mapper() cannot be null or undefined for model "${className}".`);
    }
    modelProps = modelMapper.type.modelProperties;
    if (!modelProps) {
      throw new Error(
        `modelProperties cannot be null or undefined in the ` +
          `mapper "${JSON.stringify(
            modelMapper
          )}" of type "${className}" for object "${objectName}".`
      );
    }
  }

  return modelProps;
}

function serializeCompositeType(
  serializer: Serializer,
  mapper: CompositeMapper,
  object: any,
  objectName: string,
  isXml: boolean
): any {
  if (getPolymorphicDiscriminatorRecursively(serializer, mapper)) {
    mapper = getPolymorphicMapper(serializer, mapper, object, "clientName");
  }

  if (object != undefined) {
    const payload: any = {};
    const modelProps = resolveModelProperties(serializer, mapper, objectName);
    for (const key of Object.keys(modelProps)) {
      const propertyMapper = modelProps[key];
      if (propertyMapper.readOnly) {
        continue;
      }

      let propName: string | undefined;
      let parentObject: any = payload;
      if (serializer.isXML) {
        if (propertyMapper.xmlIsWrapped) {
          propName = propertyMapper.xmlName;
        } else {
          propName = propertyMapper.xmlElementName || propertyMapper.xmlName;
        }
      } else {
        const paths = splitSerializeName(propertyMapper.serializedName!);
        propName = paths.pop();

        for (const pathName of paths) {
          const childObject = parentObject[pathName];
          if (
            childObject == undefined &&
            (object[key] != undefined || propertyMapper.defaultValue !== undefined)
          ) {
            parentObject[pathName] = {};
          }
          parentObject = parentObject[pathName];
        }
      }

      if (parentObject != undefined) {
        if (isXml && mapper.xmlNamespace) {
          const xmlnsKey = mapper.xmlNamespacePrefix
            ? `xmlns:${mapper.xmlNamespacePrefix}`
            : "xmlns";
          parentObject.$ = { ...parentObject.$, [xmlnsKey]: mapper.xmlNamespace };
        }
        const propertyObjectName =
          propertyMapper.serializedName !== ""
            ? objectName + "." + propertyMapper.serializedName
            : objectName;

        let toSerialize = object[key];
        const polymorphicDiscriminator = getPolymorphicDiscriminatorRecursively(serializer, mapper);
        if (
          polymorphicDiscriminator &&
          polymorphicDiscriminator.clientName === key &&
          toSerialize == undefined
        ) {
          toSerialize = mapper.serializedName;
        }

        const serializedValue = serializer.serialize(
          propertyMapper,
          toSerialize,
          propertyObjectName
        );

        if (serializedValue !== undefined && propName != undefined) {
          const value = getXmlObjectValue(propertyMapper, serializedValue, isXml);
          if (isXml && propertyMapper.xmlIsAttribute) {
            // $ is the key attributes are kept under in xml2js.
            // This keeps things simple while preventing name collision
            // with names in user documents.
            parentObject.$ = parentObject.$ || {};
            parentObject.$[propName] = serializedValue;
          } else if (isXml && propertyMapper.xmlIsWrapped) {
            parentObject[propName] = { [propertyMapper.xmlElementName!]: value };
          } else {
            parentObject[propName] = value;
          }
        }
      }
    }

    const additionalPropertiesMapper = mapper.type.additionalProperties;
    if (additionalPropertiesMapper) {
      const propNames = Object.keys(modelProps);
      for (const clientPropName in object) {
        const isAdditionalProperty = propNames.every((pn) => pn !== clientPropName);
        if (isAdditionalProperty) {
          payload[clientPropName] = serializer.serialize(
            additionalPropertiesMapper,
            object[clientPropName],
            objectName + '["' + clientPropName + '"]'
          );
        }
      }
    }

    return payload;
  }
  return object;
}

function getXmlObjectValue(propertyMapper: Mapper, serializedValue: any, isXml: boolean) {
  if (!isXml || !propertyMapper.xmlNamespace) {
    return serializedValue;
  }

  const xmlnsKey = propertyMapper.xmlNamespacePrefix
    ? `xmlns:${propertyMapper.xmlNamespacePrefix}`
    : "xmlns";
  const xmlNamespace = { [xmlnsKey]: propertyMapper.xmlNamespace };

  if (["Composite"].includes(propertyMapper.type.name)) {
    return { $: xmlNamespace, ...serializedValue };
  }
  return { _: serializedValue, $: xmlNamespace };
}

function isSpecialXmlProperty(propertyName: string): boolean {
  return ["$", "_"].includes(propertyName);
}

function deserializeCompositeType(
  serializer: Serializer,
  mapper: CompositeMapper,
  responseBody: any,
  objectName: string
): any {
  if (getPolymorphicDiscriminatorRecursively(serializer, mapper)) {
    mapper = getPolymorphicMapper(serializer, mapper, responseBody, "serializedName");
  }

  const modelProps = resolveModelProperties(serializer, mapper, objectName);
  let instance: { [key: string]: any } = {};
  const handledPropertyNames: string[] = [];

  for (const key of Object.keys(modelProps)) {
    const propertyMapper = modelProps[key];
    const paths = splitSerializeName(modelProps[key].serializedName!);
    handledPropertyNames.push(paths[0]);
    const { serializedName, xmlName, xmlElementName } = propertyMapper;
    let propertyObjectName = objectName;
    if (serializedName !== "" && serializedName !== undefined) {
      propertyObjectName = objectName + "." + serializedName;
    }

    const headerCollectionPrefix = (propertyMapper as DictionaryMapper).headerCollectionPrefix;
    if (headerCollectionPrefix) {
      const dictionary: any = {};
      for (const headerKey of Object.keys(responseBody)) {
        if (headerKey.startsWith(headerCollectionPrefix)) {
          dictionary[headerKey.substring(headerCollectionPrefix.length)] = serializer.deserialize(
            (propertyMapper as DictionaryMapper).type.value,
            responseBody[headerKey],
            propertyObjectName
          );
        }

        handledPropertyNames.push(headerKey);
      }
      instance[key] = dictionary;
    } else if (serializer.isXML) {
      if (propertyMapper.xmlIsAttribute && responseBody.$) {
        instance[key] = serializer.deserialize(
          propertyMapper,
          responseBody.$[xmlName!],
          propertyObjectName
        );
      } else {
        const propertyName = xmlElementName || xmlName || serializedName;
        let unwrappedProperty = responseBody[propertyName!];
        if (propertyMapper.xmlIsWrapped) {
          unwrappedProperty = responseBody[xmlName!];
          unwrappedProperty = unwrappedProperty && unwrappedProperty[xmlElementName!];

          const isEmptyWrappedList = unwrappedProperty === undefined;
          if (isEmptyWrappedList) {
            unwrappedProperty = [];
          }
        }
        instance[key] = serializer.deserialize(
          propertyMapper,
          unwrappedProperty,
          propertyObjectName
        );
      }
    } else {
      // deserialize the property if it is present in the provided responseBody instance
      let propertyInstance;
      let res = responseBody;
      // traversing the object step by step.
      for (const item of paths) {
        if (!res) break;
        res = res[item];
      }
      propertyInstance = res;
      const polymorphicDiscriminator = mapper.type.polymorphicDiscriminator;
      // checking that the model property name (key)(ex: "fishtype") and the
      // clientName of the polymorphicDiscriminator {metadata} (ex: "fishtype")
      // instead of the serializedName of the polymorphicDiscriminator (ex: "fish.type")
      // is a better approach. The generator is not consistent with escaping '\.' in the
      // serializedName of the property (ex: "fish\.type") that is marked as polymorphic discriminator
      // and the serializedName of the metadata polymorphicDiscriminator (ex: "fish.type"). However,
      // the clientName transformation of the polymorphicDiscriminator (ex: "fishtype") and
      // the transformation of model property name (ex: "fishtype") is done consistently.
      // Hence, it is a safer bet to rely on the clientName of the polymorphicDiscriminator.
      if (
        polymorphicDiscriminator &&
        key === polymorphicDiscriminator.clientName &&
        propertyInstance == undefined
      ) {
        propertyInstance = mapper.serializedName;
      }

      let serializedValue;
      // paging
      if (Array.isArray(responseBody[key]) && modelProps[key].serializedName === "") {
        propertyInstance = responseBody[key];
        instance = serializer.deserialize(propertyMapper, propertyInstance, propertyObjectName);
      } else if (propertyInstance !== undefined || propertyMapper.defaultValue !== undefined) {
        serializedValue = serializer.deserialize(
          propertyMapper,
          propertyInstance,
          propertyObjectName
        );
        instance[key] = serializedValue;
      }
    }
  }

  const additionalPropertiesMapper = mapper.type.additionalProperties;
  if (additionalPropertiesMapper) {
    const isAdditionalProperty = (responsePropName: string): boolean => {
      for (const clientPropName in modelProps) {
        const paths = splitSerializeName(modelProps[clientPropName].serializedName);
        if (paths[0] === responsePropName) {
          return false;
        }
      }
      return true;
    };

    for (const responsePropName in responseBody) {
      if (isAdditionalProperty(responsePropName)) {
        instance[responsePropName] = serializer.deserialize(
          additionalPropertiesMapper,
          responseBody[responsePropName],
          objectName + '["' + responsePropName + '"]'
        );
      }
    }
  } else if (responseBody) {
    for (const key of Object.keys(responseBody)) {
      if (
        instance[key] === undefined &&
        !handledPropertyNames.includes(key) &&
        !isSpecialXmlProperty(key)
      ) {
        instance[key] = responseBody[key];
      }
    }
  }

  return instance;
}

function deserializeDictionaryType(
  serializer: Serializer,
  mapper: DictionaryMapper,
  responseBody: any,
  objectName: string
): { [key: string]: any } {
  const value = mapper.type.value;
  if (!value || typeof value !== "object") {
    throw new Error(
      `"value" metadata for a Dictionary must be defined in the ` +
        `mapper and it must of type "object" in ${objectName}`
    );
  }
  if (responseBody) {
    const tempDictionary: { [key: string]: any } = {};
    for (const key of Object.keys(responseBody)) {
      tempDictionary[key] = serializer.deserialize(value, responseBody[key], objectName);
    }
    return tempDictionary;
  }
  return responseBody;
}

function deserializeSequenceType(
  serializer: Serializer,
  mapper: SequenceMapper,
  responseBody: any,
  objectName: string
): any[] {
  const element = mapper.type.element;
  if (!element || typeof element !== "object") {
    throw new Error(
      `element" metadata for an Array must be defined in the ` +
        `mapper and it must of type "object" in ${objectName}`
    );
  }
  if (responseBody) {
    if (!Array.isArray(responseBody)) {
      // xml2js will interpret a single element array as just the element, so force it to be an array
      responseBody = [responseBody];
    }

    const tempArray = [];
    for (let i = 0; i < responseBody.length; i++) {
      tempArray[i] = serializer.deserialize(element, responseBody[i], `${objectName}[${i}]`);
    }
    return tempArray;
  }
  return responseBody;
}

function getPolymorphicMapper(
  serializer: Serializer,
  mapper: CompositeMapper,
  object: any,
  polymorphicPropertyName: "clientName" | "serializedName"
): CompositeMapper {
  const polymorphicDiscriminator = getPolymorphicDiscriminatorRecursively(serializer, mapper);
  if (polymorphicDiscriminator) {
    const discriminatorName = polymorphicDiscriminator[polymorphicPropertyName];
    if (discriminatorName != undefined) {
      const discriminatorValue = object[discriminatorName];
      if (discriminatorValue != undefined) {
        const typeName = mapper.type.uberParent || mapper.type.className;
        const indexDiscriminator =
          discriminatorValue === typeName
            ? discriminatorValue
            : typeName + "." + discriminatorValue;
        const polymorphicMapper = serializer.modelMappers.discriminators[indexDiscriminator];
        if (polymorphicMapper) {
          mapper = polymorphicMapper;
        }
      }
    }
  }
  return mapper;
}

function getPolymorphicDiscriminatorRecursively(
  serializer: Serializer,
  mapper: CompositeMapper
): PolymorphicDiscriminator | undefined {
  return (
    mapper.type.polymorphicDiscriminator ||
    getPolymorphicDiscriminatorSafely(serializer, mapper.type.uberParent) ||
    getPolymorphicDiscriminatorSafely(serializer, mapper.type.className)
  );
}

function getPolymorphicDiscriminatorSafely(serializer: Serializer, typeName?: string): any {
  return (
    typeName &&
    serializer.modelMappers[typeName] &&
    serializer.modelMappers[typeName].type.polymorphicDiscriminator
  );
}

export interface MapperConstraints {
  InclusiveMaximum?: number;
  ExclusiveMaximum?: number;
  InclusiveMinimum?: number;
  ExclusiveMinimum?: number;
  MaxLength?: number;
  MinLength?: number;
  Pattern?: RegExp;
  MaxItems?: number;
  MinItems?: number;
  UniqueItems?: true;
  MultipleOf?: number;
}

export type MapperType =
  | SimpleMapperType
  | CompositeMapperType
  | SequenceMapperType
  | DictionaryMapperType
  | EnumMapperType;

export interface SimpleMapperType {
  name:
    | "Base64Url"
    | "Boolean"
    | "ByteArray"
    | "Date"
    | "DateTime"
    | "DateTimeRfc1123"
    | "Object"
    | "Stream"
    | "String"
    | "TimeSpan"
    | "UnixTime"
    | "Uuid"
    | "Number"
    | "any";
}

export interface CompositeMapperType {
  name: "Composite";

  // Only one of the two below properties should be present.
  // Use className to reference another type definition,
  // and use modelProperties/additionalProperties when the reference to the other type has been resolved.
  className?: string;

  modelProperties?: { [propertyName: string]: Mapper };
  additionalProperties?: Mapper;

  uberParent?: string;
  polymorphicDiscriminator?: PolymorphicDiscriminator;
}

export interface SequenceMapperType {
  name: "Sequence";
  element: Mapper;
}

export interface DictionaryMapperType {
  name: "Dictionary";
  value: Mapper;
}

export interface EnumMapperType {
  name: "Enum";
  allowedValues: any[];
}

export interface BaseMapper {
  /**
   * Name for the xml element
   */
  xmlName?: string;
  /**
   * Xml element namespace
   */
  xmlNamespace?: string;
  /**
   * Xml element namespace prefix
   */
  xmlNamespacePrefix?: string;
  /**
   * Determines if the current property should be serialized as an attribute of the parent xml element
   */
  xmlIsAttribute?: boolean;
  /**
   * Name for the xml elements when serializing an array
   */
  xmlElementName?: string;
  /**
   * Whether or not the current propery should have a wrapping XML element
   */
  xmlIsWrapped?: boolean;
  /**
   * Whether or not the current propery is readonly
   */
  readOnly?: boolean;
  /**
   * Whether or not the current propery is a constant
   */
  isConstant?: boolean;
  /**
   * Whether or not the current propery is required
   */
  required?: boolean;
  /**
   * Whether or not the current propery allows mull as a value
   */
  nullable?: boolean;
  /**
   * The name to use when serializing
   */
  serializedName?: string;
  /**
   * Type of the mapper
   */
  type: MapperType;
  /**
   * Default value when one is not explicitly provided
   */
  defaultValue?: any;
  /**
   * Constraints to test the current value against
   */
  constraints?: MapperConstraints;
}

export type Mapper = BaseMapper | CompositeMapper | SequenceMapper | DictionaryMapper | EnumMapper;

export interface PolymorphicDiscriminator {
  serializedName: string;
  clientName: string;
  [key: string]: string;
}

export interface CompositeMapper extends BaseMapper {
  type: CompositeMapperType;
}

export interface SequenceMapper extends BaseMapper {
  type: SequenceMapperType;
}

export interface DictionaryMapper extends BaseMapper {
  type: DictionaryMapperType;
  headerCollectionPrefix?: string;
}

export interface EnumMapper extends BaseMapper {
  type: EnumMapperType;
}

export interface UrlParameterValue {
  value: string;
  skipUrlEncoding: boolean;
}

// TODO: why is this here?
export function serializeObject(toSerialize: any): any {
  if (toSerialize == undefined) return undefined;
  if (toSerialize instanceof Uint8Array) {
    toSerialize = base64.encodeByteArray(toSerialize);
    return toSerialize;
  } else if (toSerialize instanceof Date) {
    return toSerialize.toISOString();
  } else if (Array.isArray(toSerialize)) {
    const array = [];
    for (let i = 0; i < toSerialize.length; i++) {
      array.push(serializeObject(toSerialize[i]));
    }
    return array;
  } else if (typeof toSerialize === "object") {
    const dictionary: { [key: string]: any } = {};
    for (const property in toSerialize) {
      dictionary[property] = serializeObject(toSerialize[property]);
    }
    return dictionary;
  }
  return toSerialize;
}

/**
 * Utility function to create a K:V from a list of strings
 */
function strEnum<T extends string>(o: Array<T>): { [K in T]: K } {
  const result: any = {};
  for (const key of o) {
    result[key] = key;
  }
  return result;
}

export const MapperType = strEnum([
  "Base64Url",
  "Boolean",
  "ByteArray",
  "Composite",
  "Date",
  "DateTime",
  "DateTimeRfc1123",
  "Dictionary",
  "Enum",
  "Number",
  "Object",
  "Sequence",
  "String",
  "Stream",
  "TimeSpan",
  "UnixTime"
]);
